import 'dotenv/config';
import fetch from 'node-fetch';
import { fetchAccessToken } from './authClient';
import { kickOffExport, pollExportStatus } from './export/bulkExport';
import { categorizeLabResults } from './parser/filterObservations';
import { categorizeVitals } from './parser/filterVitals';
import { sendEmail } from './notify/sendEmail';
import { FHIR_BASE, GROUP_ID } from './config';
import cron from 'node-cron';

async function runReport() {
  try {
    const toAddr = process.env.ALERT_EMAIL;
    if (!toAddr) throw new Error('Please set ALERT_EMAIL in your .env');

    // 1) kick off the bulk‐export
    const token = await fetchAccessToken();
    const statusUrl = await kickOffExport(GROUP_ID, token);

    // 2) wait for the NDJSON URLs
    const exportOutput = await pollExportStatus(statusUrl, token);

    let patientUrl: string | undefined;
    const observationUrls: string[] = [];

    for (const output of exportOutput) {
      if (output.type === 'Patient') {
        patientUrl = output.url;
      } else if (output.type === 'Observation') {
        observationUrls.push(output.url);
      }
    }

    if (!patientUrl || observationUrls.length === 0) {
      throw new Error('Missing one or more expected export URLs (patient or observations)');
    }

    // 3) build a patient ID → details map
    const patientDetails: Record<string, { name: string; gender?: string; age?: number }> = {};
    {
      const res = await fetch(patientUrl, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const p: any = JSON.parse(line);
        let display = p.id;
        if (Array.isArray(p.name) && p.name.length > 0) {
          const nm = p.name[0];
          if (nm.text) {
            display = nm.text;
          } else {
            const given = Array.isArray(nm.given) ? nm.given.join(' ') : '';
            const fam = nm.family || '';
            display = [given, fam].filter(Boolean).join(' ');
          }
        }
        // Calculate age
        let age: number | undefined = undefined;
        if (p.birthDate?.trim()) {
          const dob = new Date(p.birthDate);
          const now = new Date();
          age = now.getFullYear() - dob.getFullYear();
          const m = now.getMonth() - dob.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
        }
        patientDetails[p.id] = { name: display, gender: p.gender, age };
      }
      // Print patient map for debugging
      console.log('Patient map:', patientDetails);
    }

    // 4) categorize labs
    const { normal: normalLabs, abnormal: abnormalLabs } =
      await categorizeLabResults(observationUrls, token, Object.fromEntries(Object.entries(patientDetails).map(([id, d]) => [id, d.name])));

    // 5) categorize vitals
    const { normal: normalVitals, abnormal: abnormalVitals, unclassified: unclassifiedVitals } =
      await categorizeVitals(observationUrls, token, Object.fromEntries(Object.entries(patientDetails).map(([id, d]) => [id, d.name])));

    // Group results by patient
    const patientIds = Array.from(new Set([
      ...normalLabs.map(r => r.patientId),
      ...abnormalLabs.map(r => r.patientId),
      ...normalVitals.map(r => r.patientId),
      ...abnormalVitals.map(r => r.patientId),
      ...unclassifiedVitals.map(r => r.patientId)
    ]));

    // Build patient-centric result map
    const patientResults = patientIds.map(pid => ({
      id: pid,
      name: patientDetails[pid].name,
      gender: patientDetails[pid].gender,
      age: patientDetails[pid].age,
      abnormalLabs: abnormalLabs.filter(r => r.patientId === pid),
      normalLabs: normalLabs.filter(r => r.patientId === pid),
      abnormalVitals: abnormalVitals.filter(r => r.patientId === pid),
      normalVitals: normalVitals.filter(r => r.patientId === pid),
      unclassifiedVitals: unclassifiedVitals.filter(r => r.patientId === pid)
    }));

    // SVG bar chart for graphical summary
    const totalLabs = normalLabs.length + abnormalLabs.length;
    const totalVitals = normalVitals.length + abnormalVitals.length + unclassifiedVitals.length;
    const svgBar = (label: string, normal: number, abnormal: number, max: number) => {
      const width = 320, height = 24;
      const nW = max ? Math.round((normal / max) * width) : 0;
      const aW = max ? Math.round((abnormal / max) * width) : 0;
      return `<div style='margin-bottom:8px;'>
        <span style='font-weight:bold;'>${label}:</span>
        <svg width='${width}' height='${height}' style='vertical-align:middle;'>
          <rect x='0' y='4' width='${nW}' height='16' fill='#eafaf1'/>
          <rect x='${nW}' y='4' width='${aW}' height='16' fill='#ffeaea'/>
          <rect x='0' y='4' width='${width}' height='16' fill='none' stroke='#bbb' stroke-width='1'/>
        </svg>
        <span style='color:#27ae60;font-weight:bold;'>${normal} normal</span> &nbsp; <span style='color:#c0392b;font-weight:bold;'>${abnormal} abnormal</span>
      </div>`;
    };

    // Quick triage: patients with any abnormal results
    const triagePatients = patientResults.filter(p => p.abnormalLabs.length || p.abnormalVitals.length);
    const triageSection = triagePatients.length ? `
      <div style='margin-bottom:18px;'>
        <strong>Patients with Abnormal Results:</strong>
        <ul>
          ${triagePatients.map(p => `<li><a href="#patient-${p.id}">${p.name}${p.age ? ` (${p.age}y)` : ''}${p.gender ? `, ${p.gender}` : ''}</a></li>`).join('')}
        </ul>
      </div>
    ` : '';

    // Inline CSS for aesthetics
    const style = `
      <style>
        body { font-family: Arial, sans-serif; }
        h1, h2, h3 { color: #2c3e50; }
        .patient-section { border: 1px solid #eee; margin-bottom: 24px; border-radius: 8px; padding: 16px; background: #fafbfc; }
        .patient-header { font-size: 1.2em; margin-bottom: 8px; color: #34495e; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
        th, td { border: 1px solid #ddd; padding: 6px 10px; }
        th { background: #f3f6fa; color: #2c3e50; }
        tr.abnormal { background: #ffeaea; }
        tr.normal { background: #eafaf1; }
        .section-title { margin-top: 18px; margin-bottom: 6px; color: #2980b9; }
        .critical { color: #c0392b; font-weight: bold; }
        .warning { color: #f39c12; font-weight: bold; }
        .info { color: #3498db; font-weight: bold; }
        .quick-nav { background: #f8f9fa; padding: 12px; border-radius: 6px; margin-bottom: 20px; }
        .quick-nav a { display: inline-block; margin: 4px; padding: 6px 12px; background: #e9ecef; border-radius: 4px; text-decoration: none; color: #2c3e50; }
        .quick-nav a:hover { background: #dee2e6; }
        .severity-critical { border-left: 4px solid #c0392b; }
        .severity-warning { border-left: 4px solid #f39c12; }
        .severity-normal { border-left: 4px solid #27ae60; }
        .trend-up { color: #c0392b; }
        .trend-down { color: #27ae60; }
        .trend-stable { color: #7f8c8d; }
        .tooltip { position: relative; display: inline-block; }
        .tooltip .tooltiptext { visibility: hidden; width: 200px; background-color: #555; color: #fff; text-align: center; border-radius: 6px; padding: 5px; position: absolute; z-index: 1; bottom: 125%; left: 50%; margin-left: -100px; opacity: 0; transition: opacity 0.3s; }
        .tooltip:hover .tooltiptext { visibility: visible; opacity: 1; }
      </style>
    `;

    // Helper: determine severity level
    function getSeverityLevel(alerts: string[], abnormalLabs: number, abnormalVitals: number): 'critical' | 'warning' | 'normal' {
      if (alerts.some(a => a.toLowerCase().includes('critical'))) return 'critical';
      if (abnormalLabs > 0 || abnormalVitals > 0) return 'warning';
      return 'normal';
    }

    // Helper: get trend indicator
    function getTrendIndicator(current: number, previous: number | undefined): string {
      if (previous === undefined) return '→';
      const diff = ((current - previous) / previous) * 100;
      if (Math.abs(diff) < 5) return '→';
      return diff > 0 ? '↑' : '↓';
    }

    // Summary
    const summary = `
      <h2>Summary</h2>
      ${svgBar('Labs', normalLabs.length, abnormalLabs.length, totalLabs)}
      ${svgBar('Vitals', normalVitals.length, abnormalVitals.length, totalVitals)}
      
      <div class="quick-nav">
        <strong>Quick Navigation:</strong><br>
        ${patientResults
        .filter(p => p.abnormalLabs.length > 0 || p.abnormalVitals.length > 0)
        .map(p => `<a href="#patient-${esc(p.id)}">${esc(p.name)} (${p.abnormalLabs.length} abnormal labs, ${p.abnormalVitals.length} abnormal vitals)</a>`)
        .join('')}
      </div>

      <div style="margin-bottom: 20px;">
        <h3>Patient Overview</h3>
        <table>
          <tr style="background:#f3f6fa;">
            <th>Patient</th>
            <th>Status</th>
            <th>Abnormal Labs</th>
            <th>Abnormal Vitals</th>
            <th>Key Alerts</th>
          </tr>
          ${patientResults.map(p => {
          const alerts = cdsAlerts([...p.abnormalLabs, ...p.normalLabs], [...p.abnormalVitals, ...p.normalVitals, ...p.unclassifiedVitals]);
          const severity = getSeverityLevel(alerts, p.abnormalLabs.length, p.abnormalVitals.length);
          const severityClass = `severity-${severity}`;
          const alertSummary = alerts.length > 0
            ? alerts.slice(0, 2).join('; ') + (alerts.length > 2 ? '…' : '')
            : (p.abnormalLabs.length > 0 || p.abnormalVitals.length > 0
              ? 'Abnormal results present. Review patient details.'
              : 'All results within normal limits');

          return `<tr class="${severityClass}">
              <td><a href="#patient-${esc(p.id)}">${esc(p.name)}</a>${p.age !== undefined ? ` (${p.age}y)` : ''}${p.gender ? `, ${p.gender}` : ''}</td>
              <td>${severity === 'critical' ? '<span class="critical">Critical</span>' :
              severity === 'warning' ? '<span class="warning">Warning</span>' :
                '<span class="info">Normal</span>'}</td>
              <td style="color:#c0392b;font-weight:bold;">${p.abnormalLabs.length}</td>
              <td style="color:#c0392b;font-weight:bold;">${p.abnormalVitals.length}</td>
              <td>${esc(alertSummary)}</td>
            </tr>`;
        }).join('')}
        </table>
      </div>
    `;

    // Helper to highlight critical values with trend
    function highlightCritical(val: number | undefined, low: number | undefined, high: number | undefined, previousVal?: number) {
      if (val === undefined || low === undefined || high === undefined) return val;
      const trend = previousVal !== undefined ? getTrendIndicator(val, previousVal) : '';
      const trendClass = trend === '↑' ? 'trend-up' : trend === '↓' ? 'trend-down' : 'trend-stable';

      if (val < low * 0.8 || val > high * 1.2) {
        return `<span class='critical'>${val} <span class="${trendClass}">${trend}</span></span>`;
      }
      if (val < low || val > high) {
        return `<span style='color:#c0392b;font-weight:bold;'>${val} <span class="${trendClass}">${trend}</span></span>`;
      }
      return `${val} <span class="${trendClass}">${trend}</span>`;
    }

    // Helper: format date for display with tooltip
    function formatDate(isoDateString: string | undefined): string {
      if (!isoDateString) return '';
      try {
        const date = new Date(isoDateString);
        const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<span class="tooltip">${formattedDate}<span class="tooltiptext">${isoDateString}</span></span>`;
      } catch (e) {
        return '';
      }
    }

    // Helper: trend chart for a vital sign
    function vitalTrendChart(values: { value: number | undefined, low: number | undefined, high: number | undefined }[], width = 180, height = 40) {
      // Filter out any values where value, low, or high are undefined
      const filteredValues = values.filter((v): v is { value: number, low: number, high: number } =>
        v.value !== undefined && v.low !== undefined && v.high !== undefined
      );

      if (filteredValues.length < 2) return '';

      // Extract numeric arrays for clarity and type safety
      const chartValues = filteredValues.map(v => v.value);
      const chartLows = filteredValues.map(v => v.low);
      const chartHighs = filteredValues.map(v => v.high);

      // Ensure min and max calculations are on numbers
      const allChartDataPoints = [...chartValues, ...chartLows, ...chartHighs];
      const min = Math.min(...allChartDataPoints);
      const max = Math.max(...allChartDataPoints);

      const y = (v: number) => height - ((v - min) / (max - min || 1)) * (height - 10) - 5;
      const x = (i: number) => (i / (filteredValues.length - 1 || 1)) * (width - 10) + 5;

      // Line path
      const points = chartValues.map((val, i) => `${x(i)},${y(val)}`).join(' ');
      // Abnormal points
      const abnPts = filteredValues.map((v, i) => (v.value < v.low || v.value > v.high) ? `<circle cx='${x(i)}' cy='${y(v.value)}' r='3' fill='#c0392b' />` : '').join('');
      // Normal points
      const normPts = filteredValues.map((v, i) => (v.value >= v.low && v.value <= v.high) ? `<circle cx='${x(i)}' cy='${y(v.value)}' r='3' fill='#27ae60' />` : '').join('');
      // Reference range band
      const bandY1 = y(Math.max(...chartLows));
      const bandY2 = y(Math.min(...chartHighs));
      return `<svg width='${width}' height='${height}' style='margin-bottom:4px;'><rect x='0' y='${bandY2}' width='${width}' height='${bandY1 - bandY2}' fill='#eafaf1' /><polyline fill='none' stroke='#2980b9' stroke-width='2' points='${points}' />${abnPts}${normPts}</svg>`;
    }

    // Helper: CDS rules (Epic/SMART on FHIR inspired)
    function cdsAlerts(labs: any[], vitals: any[]) {
      const alerts: string[] = [];
      // Example: Hypertension
      const sys = vitals.find(v => v.display.toLowerCase().includes('systolic'));
      const dia = vitals.find(v => v.display.toLowerCase().includes('diastolic'));
      if (sys && sys.value >= 140) alerts.push('Hypertensive: Systolic BP ≥ 140');
      if (dia && dia.value >= 90) alerts.push('Hypertensive: Diastolic BP ≥ 90');
      // Example: Bradycardia/Tachycardia
      const hr = vitals.find(v => v.display.toLowerCase().includes('heart rate'));
      if (hr && hr.value < 60) alerts.push('Bradycardia: Heart Rate < 60');
      if (hr && hr.value > 100) alerts.push('Tachycardia: Heart Rate > 100');
      // Example: Hypoxemia
      const ox = vitals.find(v => v.display.toLowerCase().includes('oxygen saturation'));
      if (ox && ox.value < 92) alerts.push('Hypoxemia: O2 Sat < 92%');
      // Example: Hyperkalemia/Hypokalemia (if potassium lab present)
      const k = labs.find(l => l.test.toLowerCase().includes('potassium'));
      if (k && k.value < 3.0) alerts.push('Hypokalemia: Potassium < 3.0');
      if (k && k.value > 5.5) alerts.push('Hyperkalemia: Potassium > 5.5');
      // Example: Diabetes (if A1c present)
      const a1c = labs.find(l => l.test.toLowerCase().includes('a1c'));
      if (a1c && a1c.value >= 6.5) alerts.push('Diabetes: A1c ≥ 6.5%');
      return alerts;
    }

    // Helper: escape HTML for patient names/ids
    function esc(str: string | undefined) {
      return (str ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    }

    // Helper: show more/less toggle for tables
    function showMoreTable(rows: string[], maxRows: number, tableId: string) {
      if (rows.length <= maxRows) return rows.join('');
      return `
        ${rows.slice(0, maxRows).join('')}
        <tr id="showmore-${tableId}"><td colspan="100%" style="text-align:center;cursor:pointer;color:#2980b9;" onclick="this.style.display='none';document.querySelectorAll('.more-${tableId}').forEach(r=>r.style.display='');">Show more…</td></tr>
        ${rows.slice(maxRows).map(r => r.replace('<tr', `<tr class='more-${tableId}' style='display:none;'`)).join('')}
      `;
    }

    // Helper: trend chart for a vital/lab sign (with placeholder)
    function trendChart(values: { value: number, low: number, high: number }[], width = 180, height = 40) {
      if (values.length < 2) {
        // Show a single point or placeholder
        const y = height / 2, x = width / 2;
        return `<svg width='${width}' height='${height}' style='margin-bottom:4px;'><circle cx='${x}' cy='${y}' r='4' fill='#bbb' /><text x='${x + 8}' y='${y + 4}' font-size='12' fill='#888'>No trend data</text></svg>`;
      }
      const min = Math.min(...values.map(v => v.value), ...values.map(v => v.low)),
        max = Math.max(...values.map(v => v.value), ...values.map(v => v.high));
      const y = (v: number) => height - ((v - min) / (max - min || 1)) * (height - 10) - 5;
      const x = (i: number) => (i / (values.length - 1 || 1)) * (width - 10) + 5;
      const points = values.map((v, i) => `${x(i)},${y(v.value)}`).join(' ');
      const abnPts = values.map((v, i) => (v.value < v.low || v.value > v.high) ? `<circle cx='${x(i)}' cy='${y(v.value)}' r='3' fill='#c0392b' />` : '').join('');
      const normPts = values.map((v, i) => (v.value >= v.low && v.value <= v.high) ? `<circle cx='${x(i)}' cy='${y(v.value)}' r='3' fill='#27ae60' />` : '').join('');
      const bandY1 = y(Math.max(...values.map(v => v.low)));
      const bandY2 = y(Math.min(...values.map(v => v.high)));
      return `<svg width='${width}' height='${height}' style='margin-bottom:4px;'><rect x='0' y='${bandY2}' width='${width}' height='${bandY1 - bandY2}' fill='#eafaf1' /><polyline fill='none' stroke='#2980b9' stroke-width='2' points='${points}' />${abnPts}${normPts}</svg>`;
    }

    // Patient sections (collapsible)
    const patientSections = patientResults.map(p => {
      const alerts = cdsAlerts([...p.abnormalLabs, ...p.normalLabs], [...p.abnormalVitals, ...p.normalVitals, ...p.unclassifiedVitals]);
      const severity = getSeverityLevel(alerts, p.abnormalLabs.length, p.abnormalVitals.length);
      const severityClass = `severity-${severity}`;

      // Group vitals by display name, exclude height/weight
      const allVitals = [...p.abnormalVitals, ...p.normalVitals, ...p.unclassifiedVitals];
      const vitalsByType: Record<string, { value: number, low: number, high: number, unit: string, timestamp?: string }[]> = {};

      let latestHeight: { value: number, unit: string, timestamp?: string } | undefined;
      let latestWeight: { value: number, unit: string, timestamp?: string } | undefined;

      allVitals.forEach(v => {
        const key = v.display;
        // Find latest Height and Weight
        if (/height/i.test(key)) {
          if (v.value !== undefined) {
            if (!latestHeight || (v.timestamp && (!latestHeight.timestamp || new Date(v.timestamp) > new Date(latestHeight.timestamp)))) {
              latestHeight = { value: v.value, unit: v.unit || '', timestamp: v.timestamp };
            }
          }
          return; // Exclude height from trends
        }
        if (/weight/i.test(key)) {
          if (v.value !== undefined) {
            if (!latestWeight || (v.timestamp && (!latestWeight.timestamp || new Date(v.timestamp) > new Date(latestWeight.timestamp)))) {
              latestWeight = { value: v.value, unit: v.unit || '', timestamp: v.timestamp };
            }
          }
          return; // Exclude weight from trends
        }
        if (/height|weight/i.test(key)) return; // Exclude height/weight
        if (v.value !== undefined && v.low !== undefined && v.high !== undefined) {
          if (!vitalsByType[key]) vitalsByType[key] = [];
          vitalsByType[key].push({ value: v.value, low: v.low, high: v.high, unit: v.unit || '', timestamp: v.timestamp });
        }
      });

      // Sort vitals by type (abnormal first, then alphabetical)
      const sortedVitalTypes = Object.entries(vitalsByType).sort(([a, aVals], [b, bVals]) => {
        const aHasAbnormal = aVals.some(v => v.value < v.low || v.value > v.high);
        const bHasAbnormal = bVals.some(v => v.value < v.low || v.value > v.high);
        if (aHasAbnormal !== bHasAbnormal) return bHasAbnormal ? 1 : -1;
        return a.localeCompare(b);
      });

      // Group labs by test name for trend charts
      const allLabs = [...p.abnormalLabs, ...p.normalLabs];
      const labsByType: Record<string, { value: number, low: number, high: number, unit: string, timestamp?: string }[]> = {};
      allLabs.forEach(l => {
        const key = l.test;
        if (!labsByType[key]) labsByType[key] = [];
        if (l.value !== undefined && l.low !== undefined && l.high !== undefined) {
          labsByType[key].push({ value: l.value, low: l.low, high: l.high, unit: l.unit || '', timestamp: l.timestamp });
        }
      });

      // Sort labs by type (abnormal first, then alphabetical)
      const sortedLabTypes = Object.entries(labsByType).sort(([a, aVals], [b, bVals]) => {
        const aHasAbnormal = aVals.some(v => v.value < v.low || v.value > v.high);
        const bHasAbnormal = bVals.some(v => v.value < v.low || v.value > v.high);
        if (aHasAbnormal !== bHasAbnormal) return bHasAbnormal ? 1 : -1;
        return a.localeCompare(b);
      });

      return `
      <details class="patient-section ${severityClass}" id="patient-${esc(p.id)}">
        <summary class="patient-header">
          <strong>Patient:</strong> ${esc(p.name)} 
          <span style="color:#888;font-size:0.9em;">(${esc(p.id)})</span>
          ${p.age !== undefined ? ` &nbsp; <strong>Age:</strong> ${p.age}` : ''}
          ${p.gender ? ` &nbsp; <strong>Gender:</strong> ${esc(p.gender)}` : ''}
          ${latestHeight ? ` &nbsp; <strong>Height:</strong> ${latestHeight.value}${esc(latestHeight.unit)}` : ''}
          ${latestWeight ? ` &nbsp; <strong>Weight:</strong> ${latestWeight.value}${esc(latestWeight.unit)}` : ''}
          ${severity === 'critical' ? ' &nbsp; <span class="critical">[Critical]</span>' :
          severity === 'warning' ? ' &nbsp; <span class="warning">[Warning]</span>' : ''}
        </summary>
        ${alerts.length ? `<div style='color:#c0392b; font-weight:bold; margin-bottom:8px;'>${alerts.map(a => `⚠️ ${esc(a)}`).join('<br>')}</div>` : ''}
        
        ${sortedVitalTypes.map(([vital, vals]) => {
            const unit = vals[0].unit ? vals[0].unit : '';
            const maxRows = 3;
            const tableId = `${esc(p.id)}-${esc(vital)}`;
            const rows = vals.map((v, i) => {
              const previousVal = i > 0 ? vals[i - 1].value : undefined;
              return `
              <tr class="${v.value < v.low || v.value > v.high ? 'abnormal' : 'normal'}">
                <td>${highlightCritical(v.value, v.low, v.high, previousVal)}</td>
                <td>${esc(v.unit)}</td>
                <td>${v.low} - ${v.high}</td>
                <td>${formatDate(v.timestamp)}</td>
              </tr>
            `;
            });
            return `
            <div class="section-title">${esc(vital)} Trend (${esc(unit)})</div>
            ${trendChart(vals, 180, 40)}
            <table><tr><th>Value</th><th>Unit</th><th>Reference Range</th><th>Date</th></tr>
              ${showMoreTable(rows, maxRows, tableId)}
            </table>
          `;
          }).join('')}

        ${sortedLabTypes.filter(([lab, vals]) => vals.length > 1).map(([lab, vals]) => {
            const unit = vals[0].unit ? vals[0].unit : '';
            const maxRows = 3;
            const tableId = `${esc(p.id)}-${esc(lab)}`;
            const rows = vals.map((lr, i) => {
              const previousVal = i > 0 ? vals[i - 1].value : undefined;
              return `
              <tr class="${lr.value < lr.low || lr.value > lr.high ? 'abnormal' : 'normal'}">
                <td>${highlightCritical(lr.value, lr.low, lr.high, previousVal)}</td>
                <td>${esc(lr.unit)}</td>
                <td>${lr.low} - ${lr.high}</td>
                <td>${formatDate(lr.timestamp)}</td>
              </tr>
            `;
            });
            return `
            <div class="section-title">${esc(lab)} Trend (${esc(unit)})</div>
            ${trendChart(vals, 180, 40)}
            <table><tr><th>Value</th><th>Unit</th><th>Reference Range</th><th>Date</th></tr>
              ${showMoreTable(rows, maxRows, tableId)}
            </table>
          `;
          }).join('')}

        ${p.abnormalLabs.length ? `
          <div class="section-title">Abnormal Labs (${p.abnormalLabs.length})</div>
          <table><tr><th>Test</th><th>Value</th><th>Unit</th><th>Reference Range</th><th>Date</th></tr>
            ${p.abnormalLabs.map((lr, i) => {
            const previousVal = i > 0 ? p.abnormalLabs[i - 1].value : undefined;
            return `
                <tr class="abnormal">
                  <td>${esc(lr.test)}</td>
                  <td>${highlightCritical(lr.value, lr.low, lr.high, previousVal)}</td>
                  <td>${esc(lr.unit || '')}</td>
                  <td>${lr.low} - ${lr.high}</td>
                  <td>${formatDate(lr.timestamp)}</td>
                </tr>
              `;
          }).join('')}
          </table>` : ''}

        ${p.normalLabs.length ? `
          <div class="section-title">Normal Labs (${p.normalLabs.length})</div>
          <table><tr><th>Test</th><th>Value</th><th>Unit</th><th>Reference Range</th><th>Date</th></tr>
            ${p.normalLabs.map((lr, i) => {
            const previousVal = i > 0 ? p.normalLabs[i - 1].value : undefined;
            return `
                <tr class="normal">
                  <td>${esc(lr.test)}</td>
                  <td>${highlightCritical(lr.value, lr.low, lr.high, previousVal)}</td>
                  <td>${esc(lr.unit || '')}</td>
                  <td>${lr.low} - ${lr.high}</td>
                  <td>${formatDate(lr.timestamp)}</td>
                </tr>
              `;
          }).join('')}
          </table>` : ''}

        ${(() => {
          const displayableUnclassifiedVitals = p.unclassifiedVitals.filter(v => v.value !== undefined);
          if (displayableUnclassifiedVitals.length === 0) return '';
          return `
          <div class="section-title">Unclassified Vitals (${displayableUnclassifiedVitals.length})</div>
          <table><tr><th>Vital</th><th>Value</th><th>Unit</th><th>Date</th></tr>
            ${displayableUnclassifiedVitals.map(v => `
              <tr class="normal">
                <td>${esc(v.display)}</td>
                <td>${v.value !== undefined ? v.value : 'N/A'}</td>
                <td>${esc(v.unit || '')}</td>
                <td>${formatDate(v.timestamp)}</td>
              </tr>
            `).join('')}
          </table>`;
        })()}

      </details>
    `}).join('');

    // Add Show All/Collapse All toggle
    const toggleScript = `
      <script>
        function showAllPatients(expand) {
          document.querySelectorAll('.patient-section').forEach(d => d.open = expand);
        }
      </script>
      <div style='margin-bottom:12px;'>
        <button onclick='showAllPatients(true)' style='margin-right:8px;'>Show All</button>
        <button onclick='showAllPatients(false)'>Collapse All</button>
      </div>
    `;

    const html = `
      ${style}
      <h1>Daily Patient Report</h1>
      ${toggleScript}
      ${summary}
      ${patientSections}
    `;

    const subject = `Daily Patient Report: ${abnormalLabs.length} Abnormal Labs, ${abnormalVitals.length} Abnormal Vitals, ${unclassifiedVitals.length} Unclassified Vitals`;

    await sendEmail(toAddr, subject, html);

    console.log('✅ Email sent—check the Ethereal preview URL above');
  } catch (err: any) {
    console.error('❌ Error:', err.message || err);
    process.exit(1);
  }
}

// Run once immediately
runReport();

// Schedule to run every 24 hours at 8am server time
cron.schedule(process.env.ALERT_CRON || '0 8 * * * ', runReport);

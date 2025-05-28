// custom.d.ts

declare namespace NodeJS {
    interface ProcessEnv {
        // OAuth / FHIR
        CLIENT_ID: string;
        CLIENT_SECRET: string;
        EPIC_TOKEN_URL: string;
        FHIR_BASE: string;
        GROUP_ID: string;
        // E-mail
        ALERT_EMAIL: string;
        // (add any other env vars you reference)
    }
}

import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { parseServiceAccountFromEnv } from "./ragEnv.js";

const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

export function createDriveClient(): drive_v3.Drive {
  const sa = parseServiceAccountFromEnv();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: DRIVE_SCOPES,
  });
  return google.drive({ version: "v3", auth });
}


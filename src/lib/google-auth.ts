import { GoogleAuth } from "google-auth-library";

let auth: GoogleAuth | null = null;

export function getGoogleAuth() {
  if (!auth) {
    auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
  }

  return auth;
}

export async function getGoogleAccessToken() {
  const client = await getGoogleAuth().getClient();
  const token = await client.getAccessToken();

  if (!token.token) {
    throw new Error("Unable to mint Google OAuth access token");
  }

  return token.token;
}

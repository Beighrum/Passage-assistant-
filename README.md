<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/70149557-1599-445b-9e40-91b543c828af

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `firebase-applet-config.example.json` to `firebase-applet-config.json` and add your Firebase web app values (from the Firebase console).
3. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` and any Google OAuth variables you use.
4. Run the app:
   `npm run dev`

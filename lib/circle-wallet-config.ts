/** Public values identify the app; they confer neither account nor spending authority. */
export const CIRCLE_GOOGLE_CONNECTOR_ID = "circleGoogle";
export function circleWalletPublicConfig() {
  return {
    appId: process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "",
    googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
  };
}

export function circleWalletPublicConfigured() {
  const { appId, googleClientId } = circleWalletPublicConfig();
  return !!appId && !!googleClientId;
}

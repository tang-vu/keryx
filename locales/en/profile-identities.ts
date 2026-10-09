/** English area catalogue: provider identity never implies employment, payment or creator authority. */
export const identityCopy = Object.freeze({
  title: "Verified identity links", description: "Verify control of an ORCID or GitHub account. Verification adds a private identity link; your signed wallet remains your account authority.",
  asserted: "Links typed above are unverified. They do not become verified when their URL matches an account.",
  saveFirst: "Save your private profile before verifying an identity.", unavailable: "Verified identity links are unavailable on this storage deployment.",
  busy: "Working…", verifyOrcid: "Verify ORCID", verifyGithub: "Verify GitHub", unlink: "Unlink", reverify: "Verify again",
  failed: "Identity verification did not complete. Try again from this profile.", conflict: "That external account is already linked to another profile.",
  verified: "Verification returned. Your recorded verified links are shown below.", unlinked: "Identity link removed. Pending verification for this provider was cancelled.",
  ownership: "Verification confirms account control on the recorded date. It does not verify affiliation, research, payment eligibility or creator status.",
  scope: "ORCID shares only your iD and name. GitHub shares only your public account ID and login. Provider tokens are not retained.",
  changed: "Your signed-in wallet changed. Reload this profile.", invalid: "Identity verification could not be started.",
  date: (value: string) => `Verified at ${value}`,
});

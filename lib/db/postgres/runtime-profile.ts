/** Independent fresh SOURCE artifact. A candidate must pass the complete native
 * factory/domain fixture and required CI before merge/use. A deployment manifest
 * or target cannot allocate another approved profile. */
export const NATIVE_READONLY_RUNTIME_PROFILE=Object.freeze({
 format:'keryx-native-postgres-observation-profile-v1',
 digestFormat:'keryx-postgres17-jsonb-text-sha256-v1',
 sourceSqlSha256:'3d6d8b50e2241a8f1972501f15aec0619fbfafc07d5e1a468ee9daabcd4a9cff',
 catalogSha256:'3c6074ffdd9c2effc5fc59d09d650c643902e6238d8424fd37d5ee08e9b4580a',
});
/** Independently measured producer SOURCE, unapproved for application/cold
 * factory admission. Only the explicit development DATA-intake lane uses it. */
export const NATIVE_CURRENT_DATA_INTAKE_PROFILE=Object.freeze({
 format:'keryx-native-postgres-development-data-profile-v1',
 digestFormat:'keryx-postgres17-jsonb-text-sha256-v1',
 sourceSqlSha256:'cc15c6b020b5b838eef62f7f247bec9943567cbc66dfc6359cddd599d65b848c',
 catalogSha256:'d368c98db910ff072d10d7c2a20ba3b8b2934e4f5f76c0afdd875ebfda07803f',
 nativeFunctionCount:510,applicationFactoryApproved:false,genuineColdFactoryQualified:false,fullWriterQualified:false,
});
export type NativeMaterializationProfileMode='observation505'|'development-current510-data-only';
/** A finite explicit tool mode, never a supplied profile, digest or target. */
export function nativeMaterializationProfile(mode:NativeMaterializationProfileMode='observation505'){
 if(mode==='observation505')return NATIVE_READONLY_RUNTIME_PROFILE;
 if(mode==='development-current510-data-only')return NATIVE_CURRENT_DATA_INTAKE_PROFILE;
 throw Error('Native materialization profile refused');
}

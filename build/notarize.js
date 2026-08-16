// build/notarize.js — afterSign hook for electron-builder
// 使用 @electron/notarize 对 .app 进行 Apple 公证 (notarization)
//
// 认证方式（三选一，按优先级）：
//   1. APPLE_KEYCHAIN_PROFILE（推荐）：security find-identity 存入钥匙串的 profile
//   2. APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
//   3. APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER
//
// 跳过条件：设置 SKIP_NOTARIZE=true 时跳过公证（本地调试用）

const { notarize } = require('@electron/notarize');

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // 仅对 macOS 生效
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // 允许本地调试时跳过
  if (process.env.SKIP_NOTARIZE === 'true') {
    console.log('[notarize] SKIP_NOTARIZE=true，跳过公证');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  // 优先使用 keychain profile（推荐方式）
  const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;
  if (keychainProfile) {
    console.log(`[notarize] 使用 keychain profile "${keychainProfile}" 公证 ${appPath}`);
    await notarize({
      appPath,
      tool: 'notarytool',
      keychainProfile,
      keychain: process.env.APPLE_KEYCHAIN,
    });
    console.log('[notarize] 公证完成');
    return;
  }

  // 使用 Apple ID + App-Specific Password
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (appleId && appleIdPassword && teamId) {
    console.log(`[notarize] 使用 Apple ID "${appleId}" 公证 ${appPath}`);
    await notarize({
      appPath,
      tool: 'notarytool',
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log('[notarize] 公证完成');
    return;
  }

  // 使用 App Store Connect API Key
  const appleApiKey = process.env.APPLE_API_KEY;
  const appleApiKeyId = process.env.APPLE_API_KEY_ID;
  const appleApiIssuer = process.env.APPLE_API_ISSUER;

  if (appleApiKey && appleApiKeyId && appleApiIssuer) {
    console.log(`[notarize] 使用 API Key 公证 ${appPath}`);
    await notarize({
      appPath,
      tool: 'notarytool',
      appleApiKey,
      appleApiKeyId,
      appleApiIssuer,
    });
    console.log('[notarize] 公证完成');
    return;
  }

  console.warn('[notarize] 未找到公证凭据，跳过公证。');
  console.warn('[notarize] 请设置以下任一组合：');
  console.warn('  - APPLE_KEYCHAIN_PROFILE（推荐）');
  console.warn('  - APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID');
  console.warn('  - APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER');
};

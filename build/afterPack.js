// electron-builder의 exe 편집(winCodeSign 압축 해제)은 심볼릭 링크 권한이 없는 PC에서 실패한다.
// 그래서 signAndEditExecutable을 끄고, 여기서 rcedit로 아이콘·버전 정보만 직접 넣는다.
const path = require('path');
const rcedit = require('rcedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { appInfo } = context.packager;
  const exe = path.join(context.appOutDir, 'ChiikawaPet.exe');
  await rcedit(exe, {
    icon: path.join(__dirname, 'icon.ico'),
    'file-version': appInfo.version,
    'product-version': appInfo.version,
    'version-string': {
      ProductName: appInfo.productName,
      FileDescription: appInfo.productName,
      CompanyName: appInfo.companyName || '',
      LegalCopyright: appInfo.copyright,
      InternalName: 'ChiikawaPet',
      OriginalFilename: 'ChiikawaPet.exe',
    },
  });
};

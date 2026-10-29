// Partner Center identities are configuration, never inferred from a personal account.
export function storeConfiguration(env = process.env) {
  const get = (key) => {
    const value = env[key];
    if (typeof value !== 'string' || !value.trim() || /YOUR_|REPLACE_|[<>\x00-\x1f]/i.test(value))
      throw Error('Configure ' + key + ' from Partner Center before building a submission.');
    return value.trim();
  };
  const identityName = get('PM_STORE_IDENTITY_NAME');
  const publisher = get('PM_STORE_PUBLISHER');
  const publisherDisplayName = get('PM_STORE_PUBLISHER_DISPLAY_NAME');
  const productId = get('PM_STORE_PRODUCT_ID');
  const displayName = env.PM_STORE_DISPLAY_NAME
    ? get('PM_STORE_DISPLAY_NAME')
    : 'PM Canvas Desktop';
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identityName)) throw Error('Invalid Store identity name.');
  if (!/^CN=.{1,250}$/.test(publisher)) throw Error('Invalid Store publisher distinguished name.');
  if (publisherDisplayName.length > 256) throw Error('Invalid Store publisher display name.');
  if (displayName.length > 256) throw Error('Invalid Store display name.');
  if (!/^[A-Z0-9]{12}$/.test(productId)) throw Error('Invalid Store product ID.');
  return { identityName, publisher, publisherDisplayName, productId, displayName };
}

export function storeVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw Error('A stable three-part application version is required.');
  const parts = version.split('.').map(Number);
  // Store requires a nonzero major and reserves the fourth field. This mapping stays monotonic.
  parts[0]++;
  if (parts.some((value) => value > 65535)) throw Error('MSIX version component exceeds 65535.');
  return parts.join('.') + '.0';
}

export function storeManifest(config, version) {
  const xml = (text) =>
    String(text).replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch],
    );
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:desktop6="http://schemas.microsoft.com/appx/manifest/desktop/windows10/6"
 xmlns:virtualization="http://schemas.microsoft.com/appx/manifest/virtualization/windows10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap desktop6 virtualization rescap">
 <Identity Name="${xml(config.identityName)}" Publisher="${xml(config.publisher)}" Version="${storeVersion(version)}" ProcessorArchitecture="x64"/>
 <Properties>
  <DisplayName>${xml(config.displayName || 'PM Canvas Desktop')}</DisplayName>
  <PublisherDisplayName>${xml(config.publisherDisplayName)}</PublisherDisplayName>
  <Description>Offline project planning, WBS, Gantt and Excel reports</Description>
  <Logo>assets\\StoreLogo.png</Logo>
  <desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>
  <virtualization:FileSystemWriteVirtualization><virtualization:ExcludedDirectories>
   <virtualization:ExcludedDirectory>$(KnownFolder:RoamingAppData)\\pmcanvas-desktop</virtualization:ExcludedDirectory>
   <virtualization:ExcludedDirectory>$(KnownFolder:RoamingAppData)\\PM Canvas Desktop</virtualization:ExcludedDirectory>
  </virtualization:ExcludedDirectories></virtualization:FileSystemWriteVirtualization>
 </Properties>
 <Resources><Resource Language="ko-KR"/><Resource Language="en-US"/></Resources>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0"/></Dependencies>
 <Applications><Application Id="PMCanvas" Executable="app\\PM Canvas Desktop.exe" EntryPoint="Windows.FullTrustApplication">
  <uap:VisualElements DisplayName="${xml(config.displayName || 'PM Canvas Desktop')}" Description="Offline project planning" BackgroundColor="#2563EB"
   Square150x150Logo="assets\\Square150x150Logo.png" Square44x44Logo="assets\\Square44x44Logo.png"/>
 </Application></Applications>
 <Capabilities><rescap:Capability Name="runFullTrust"/><rescap:Capability Name="unvirtualizedResources"/></Capabilities>
</Package>
`;
}

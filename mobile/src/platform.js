import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function shareFile(name, text, type = 'application/json') {
  const extension = name.match(/\.[a-z0-9]{1,12}$/i)?.[0] || '';
  const base = extension ? name.slice(0, -extension.length) : name;
  const filename = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80) + extension;
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: 'exports/' + filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    await Share.share({ title: filename, dialogTitle: '프로젝트 내보내기', files: [uri] });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

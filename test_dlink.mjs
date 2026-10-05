import axios from 'axios';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0';

async function main() {
  const surl = 'nt9BL8qosOZYlfKca4Xjkg';
  const cookie = 'lang=en; ndus=EEE_';

  const listRes = await axios.get('https://www.terabox.app/share/list', {
    params: {
      app_id: '250528',
      web: '1',
      channel: 'dubox',
      clienttype: '0',
      shorturl: surl,
      root: '1,',
    },
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/plain, */*',
      'Cookie': cookie,
    },
    timeout: 15000,
  });

  const file = listRes.data.list[0];
  console.log('file keys:', Object.keys(file));
  console.log('dlink:', file.dlink);
  console.log('fs_id:', file.fs_id);
  console.log('server_filename:', file.server_filename);
  console.log('size:', file.size);
  console.log('thumbs:', JSON.stringify(file.thumbs));

  // Try share/download
  const dlRes = await axios.post(
    'https://www.terabox.app/share/download',
    new URLSearchParams({
      app_id: '250528',
      shareid: String(listRes.data.share_id),
      uk: String(listRes.data.uk),
      fid_list: JSON.stringify([String(file.fs_id)]),
    }),
    {
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookie,
        'Referer': 'https://www.terabox.app/',
      },
      timeout: 10000,
    }
  );

  console.log('\nshare/download response:', JSON.stringify(dlRes.data, null, 2));
}

main().catch(e => console.error('FATAL:', e.message));

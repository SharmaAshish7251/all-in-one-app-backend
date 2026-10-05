import axios from 'axios';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0';

async function main() {
  const cookie = 'lang=en; ndus=EEE_';
  const surl = 'nt9BL8qosOZYlfKca4Xjkg';

  // Get file list first
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
  const shareId = listRes.data.share_id;
  const uk = listRes.data.uk;
  const fsId = file.fs_id;

  console.log('Testing share/download with different headers...\n');

  // Test 1: Original headers
  console.log('Test 1: Original headers');
  try {
    const r1 = await axios.post('https://www.terabox.app/share/download',
      new URLSearchParams({
        app_id: '250528',
        shareid: String(shareId),
        uk: String(uk),
        fid_list: JSON.stringify([String(fsId)]),
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
    console.log('  errno:', r1.data.errno, 'errmsg:', r1.data.errmsg);
  } catch (e) {
    console.log('  ERROR:', e.message);
  }

  // Test 2: Add x-requested-with
  console.log('\nTest 2: Add X-Requested-With');
  try {
    const r2 = await axios.post('https://www.terabox.app/share/download',
      new URLSearchParams({
        app_id: '250528',
        shareid: String(shareId),
        uk: String(uk),
        fid_list: JSON.stringify([String(fsId)]),
      }),
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookie,
          'Referer': 'https://www.terabox.app/',
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 10000,
      }
    );
    console.log('  errno:', r2.data.errno, 'errmsg:', r2.data.errmsg);
    if (r2.data.dlink) console.log('  dlink:', r2.data.dlink.substring(0, 80) + '...');
  } catch (e) {
    console.log('  ERROR:', e.message);
  }

  // Test 3: POST to /api/filemetas instead
  console.log('\nTest 3: Try /api/filemetas endpoint');
  try {
    const r3 = await axios.post('https://www.terabox.com/api/filemetas',
      new URLSearchParams({
        app_id: '250528',
        shareid: String(shareId),
        uk: String(uk),
        fid_list: JSON.stringify([String(fsId)]),
      }),
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookie,
          'Referer': 'https://www.terabox.com/',
        },
        timeout: 10000,
      }
    );
    console.log('  status:', r3.status);
    console.log('  data:', JSON.stringify(r3.data).substring(0, 200));
  } catch (e) {
    console.log('  ERROR:', e.message);
  }

  // Test 4: Try with jsToken and dp-logid
  console.log('\nTest 4: share/download with jsToken and dp-logid');
  const jsToken = 'F546AE83690673E1663D92DC6C3067AD81E70CF2BC40C5F259726708D48FE7680435A6566D001BF13B2D18DFC68C1355C4AC3FE4010E90C6B359DAF98C5521E854B4D3ABBDF921F9BDF07B1B725F028DEE48BC64D577A2DC97C598B8E7DD0394';
  const dpLogid = '8756465662075698941';
  try {
    const r4 = await axios.post('https://www.terabox.app/share/download',
      new URLSearchParams({
        app_id: '250528',
        shareid: String(shareId),
        uk: String(uk),
        fid_list: JSON.stringify([String(fsId)]),
        jsToken: jsToken,
        'dp-logid': dpLogid,
      }),
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookie,
          'Referer': 'https://www.terabox.app/sharing/link?surl=' + surl,
        },
        timeout: 10000,
      }
    );
    console.log('  errno:', r4.data.errno, 'errmsg:', r4.data.errmsg);
    if (r4.data.dlink) console.log('  dlink:', r4.data.dlink.substring(0, 80) + '...');
  } catch (e) {
    console.log('  ERROR:', e.message);
  }
}

main().catch(e => console.error('FATAL:', e.message));

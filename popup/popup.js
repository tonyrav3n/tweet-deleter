document.addEventListener('DOMContentLoaded', () => {
  const cleanBtn = document.getElementById('cleanBtn');
  const statusText = document.getElementById('status');
  const debugMode = document.getElementById('debugMode');

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document
        .querySelectorAll('.tab')
        .forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      const tabId = tab.getAttribute('data-tab');
      document
        .querySelectorAll('.tab-content')
        .forEach((content) => content.classList.remove('active'));
      document.getElementById(tabId)?.classList.add('active');
    });
  });

  const showStatus = (msg, isError = false) => {
    statusText.textContent = msg;
    statusText.classList.toggle('error', isError);
    statusText.style.display = 'block';
  };

  const $ = (id) => document.getElementById(id);

  const getOptions = () => {
    const keywordsRaw = $('keywords')?.value || '';
    const ignoreRaw = $('ignore')?.value || '';

    return {
      unretweet: $('unretweet')?.checked || false,
      keepPin: $('keepPin')?.checked || false,
      linkOnly: $('linkOnly')?.checked || false,
      keywords: keywordsRaw
        ? keywordsRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      ignore: ignoreRaw
        ? ignoreRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      debug: $('debugMode')?.checked || false,
    };
  };

  cleanBtn.addEventListener('click', async () => {
    showStatus('Working...');

    try {
      const opts = getOptions();
      await chrome.storage.local.set({ opts });

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab) throw new Error('Cannot find active tab.');

      if (!tab.url.includes('x.com') && !tab.url.includes('twitter.com')) {
        throw new Error('Please connect to X.com first.');
      }

      const credentials = await chrome.storage.local.get([
        'bearer',
        'timelineCTID',
        'tweetsQry',
        'tweetsQS',
      ]);
      const hasAuth =
        credentials.bearer && credentials.timelineCTID && credentials.tweetsQry;

      if (!hasAuth) {
        showStatus(
          'No API authentication information. Please scroll on the X.com profile page and try again.',
          true
        );
        return;
      }

      const response = await chrome.runtime.sendMessage({
        cmd: 'inject-cleaner',
        tabId: tab.id,
      });

      if (!response.ok) {
        throw new Error(response.err || 'Script injection failed');
      }

      showStatus(
        'Running! Keep the tab open. A notification will appear when completed.'
      );
    } catch (err) {
      showStatus('Error: ' + err.message, true);
      console.error(err);
    }
  });

  document
    .getElementById('refreshAuth')
    ?.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        if (!tab.url.includes('x.com') && !tab.url.includes('twitter.com')) {
          throw new Error('Only possible when connected to X.com');
        }

        await chrome.tabs.reload(tab.id);
        showStatus('Page reloaded. Try again in a few seconds.');
      } catch (err) {
        showStatus('Error: ' + err.message, true);
      }
    });

  chrome.storage.local.get('opts', ({ opts }) => {
    if (!opts) return;
    document.getElementById('unretweet').checked = opts.unretweet !== false;
    document.getElementById('keepPin').checked = opts.keepPin !== false;
    document.getElementById('linkOnly').checked = opts.linkOnly === true;
    if (document.getElementById('debugMode')) {
      document.getElementById('debugMode').checked = opts.debug === true;
    }
    if (opts.keywords?.length)
      document.getElementById('keywords').value = opts.keywords.join(', ');
    if (opts.ignore?.length)
      document.getElementById('ignore').value = opts.ignore.join(', ');
  });

  function updateAuthStatus() {
    chrome.storage.local.get(
      ['bearer', 'timelineCTID', 'tweetsQry'],
      (data) => {
        const hasAuth = data.bearer && data.timelineCTID && data.tweetsQry;
        const authStatus = document.getElementById('authStatus');

        if (authStatus) {
          authStatus.textContent = hasAuth
            ? '✓ API authentication information secured'
            : '⚠ Please scroll the reply tab on X.com.';
          authStatus.style.color = hasAuth ? 'green' : 'orange';
        } else {
          const newAuthStatus = document.createElement('div');
          newAuthStatus.id = 'authStatus';
          newAuthStatus.textContent = hasAuth
            ? '✓ API authentication information secured'
            : '⚠ Please scroll the reply tab on X.com.';
          newAuthStatus.style.color = hasAuth ? 'green' : 'orange';
          newAuthStatus.style.marginTop = '12px';
          document.querySelector('.container').appendChild(newAuthStatus);
        }
      }
    );
  }

  updateAuthStatus();

  setInterval(updateAuthStatus, 5000);
});

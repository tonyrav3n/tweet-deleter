if (window.__tweetCleanerLoaded) {
  console.log('Tweet-Cleaner already injected – skip');
} else {
  window.__tweetCleanerLoaded = true;

  (async () => {
    /* ───── helper ───── */
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const getCK = (n) =>
      document.cookie
        .split('; ')
        .find((r) => r.startsWith(n + '='))
        ?.split('=')[1];
    const rand = () => crypto.randomUUID().replace(/-/g, '') + '==';
    const AL = () => navigator.languages?.join(',') || 'en-US,en;q=0.9';

    const log = (msg, ...args) => {
      const timestamp = new Date().toISOString().substring(11, 19);
      console.log(`[${timestamp}] ${msg}`, ...args);
    };

    /* ───── bundle scan (fallback) ───── */
    async function scanQueryId() {
      log('Scanning bundles for queryId...');
      const manifest = await (await fetch('/manifest.json')).json();
      for (const p of Object.values(manifest)) {
        if (typeof p !== 'string' || !p.endsWith('.js')) continue;
        const txt = await (await fetch(p)).text();
        const m = txt.match(
          /UserTweetsAndReplies.{1,120}?"queryId":"([\w-]{20,})"/
        );
        if (m) return m[1];
      }
      throw new Error('queryId not found in bundles');
    }

    /* ───── popup → content script message ───── */
    chrome.runtime.onMessage.addListener(async (message) => {
      log('Tweet Cleaner received message:', message);

      if (message.cmd !== 'tweet-clean') return;

      let opts = message.opts;
      let credentials = message.credentials || {};

      opts = opts || {};
      opts.ids = Array.isArray(opts.ids) ? opts.ids : [];
      opts.ignore = Array.isArray(opts.ignore) ? opts.ignore : [];
      opts.keywords = Array.isArray(opts.keywords) ? opts.keywords : [];
      opts.unretweet = opts.unretweet ?? true;
      opts.keepPin = opts.keepPin ?? true;
      opts.linkOnly = opts.linkOnly ?? false;

      opts.debug = opts.debug ?? false;

      let bearer = credentials.bearer;
      let tweetsQry = credentials.tweetsQry;
      let tweetsQS = credentials.tweetsQS;
      let timelineCTID = credentials.timelineCTID;

      if (!bearer || !tweetsQry || !timelineCTID) {
        log('Credentials not found in message, checking storage...');
        const stored = await chrome.storage.local.get([
          'bearer',
          'tweetsQry',
          'tweetsQS',
          'timelineCTID',
        ]);
        bearer = bearer || stored.bearer;
        tweetsQry = tweetsQry || stored.tweetsQry;
        tweetsQS = tweetsQS || stored.tweetsQS;
        timelineCTID = timelineCTID || stored.timelineCTID;
      }

      log('Using credentials:', {
        bearer: bearer ? 'present' : 'missing',
        tweetsQry: tweetsQry || 'missing',
        timelineCTID: timelineCTID || 'missing',
      });

      if (!bearer || !tweetsQry || !timelineCTID) {
        alert(
          'Session information has not been captured yet.\n' +
            'Refresh X.com profile ▶ Scroll a few tweets ▶ Run again'
        );
        return;
      }

      const timelineTid = timelineCTID || rand();

      let queryId = tweetsQry;
      if (!queryId) queryId = await scanQueryId();

      const qsTmpl = (tweetsQS || '').replace(/^variables=.*?&/, '');

      const csrf = getCK('ct0');
      const uid = getCK('twid')?.substring(4);
      const lang = navigator.language.split('-')[0];
      const ua = navigator.userAgentData.brands
        .map((b) => `"${b.brand}";v="${b.version}"`)
        .join(', ');

      async function fetchTweets(cursor, retryCount = 0) {
        const vars = {
          userId: uid,
          count: 40,
          includePromotedContent: true,
          withCommunity: true,
          withVoice: true,
          ...(cursor ? { cursor } : {}),
        };

        const url = `https://x.com/i/api/graphql/${queryId}/UserTweetsAndReplies?variables=${encodeURIComponent(
          JSON.stringify(vars)
        )}&${qsTmpl}`;

        log(
          `Fetching tweets${
            cursor ? ` (cursor: ${cursor.slice(0, 10)}...)` : ''
          }${retryCount > 0 ? ` (retry ${retryCount})` : ''}`
        );

        try {
          const r = await fetch(url, {
            headers: {
              accept: '*/*',
              'accept-language': AL(),
              authorization: bearer,
              'x-csrf-token': csrf,
              'x-client-transaction-id': timelineTid,
              'x-twitter-active-user': 'yes',
              'x-twitter-auth-type': 'OAuth2Session',
              'x-twitter-client-language': lang,
              'sec-ch-ua': ua,
              'sec-ch-ua-mobile': '?0',
              'sec-ch-ua-platform': '"Windows"',
            },
            credentials: 'include',
          });

          if (r.status === 429) {
            if (retryCount < 3) {
              log('Rate limited (429), waiting and retrying...');
              const waitTime = Math.pow(2, retryCount) * 15000; // 15s, 30s, 60s
              await sleep(waitTime);
              return fetchTweets(cursor, retryCount + 1);
            } else {
              throw new Error('Rate limit exceeded after multiple retries');
            }
          }

          if (r.status === 404) {
            // 404 means the page/cursor does not exist - no more tweets
            log('No more tweets available (404)');
            return { data: null }; // Handle as empty response to terminate harvest
          }

          if (!r.ok) {
            log('Timeline fetch failed:', r.status);
            const text = await r.text();
            log('Response:', text);

            // Retry after short wait for 5xx server errors
            if (r.status >= 500 && retryCount < 2) {
              log(`Server error ${r.status}, retrying in 3s...`);
              await sleep(3000);
              return fetchTweets(cursor, retryCount + 1);
            }

            throw new Error('timeline fetch ' + r.status);
          }

          return r.json();
        } catch (err) {
          // Improved retry logic for network or other errors
          if (retryCount < 3) {
            // Exponential backoff with jitter
            const baseWait = 1000 * Math.pow(2, retryCount); // 1s, 2s, 4s
            const jitter = Math.random() * 500; // 0-500ms random
            const waitTime = baseWait + jitter;

            log(
              `Fetch error: ${err.message}. Retrying in ${Math.round(
                waitTime / 1000
              )}s...`
            );
            await sleep(waitTime);
            return fetchTweets(cursor, retryCount + 1);
          }
          throw err;
        }
      }

      const pass = (n) => {
        const L = n.legacy;

        if (!L) {
          log('Skipping tweet with no legacy data', n);
          return false;
        }

        if (opts.debug) {
          log('Evaluating tweet:', {
            id: L.id_str,
            text: L.full_text?.substring(0, 50),
            created_at: L.created_at,
            is_retweet: L.full_text?.startsWith('RT ') || false,
          });
        }

        if (opts.ignore.includes(L.id_str)) {
          if (opts.debug) log('Skipping ignored tweet:', L.id_str);
          return false;
        }

        if (opts.ids.length && !opts.ids.includes(L.id_str)) {
          if (opts.debug) log('Skipping tweet not in ID list:', L.id_str);
          return false;
        }

        if (opts.linkOnly && !L.entities?.urls?.length) {
          if (opts.debug) log('Skipping tweet with no links:', L.id_str);
          return false;
        }

        if (opts.keywords.length) {
          const hasKeyword = opts.keywords.some((k) =>
            L.full_text?.includes(k)
          );
          if (!hasKeyword) {
            if (opts.debug) log('Skipping tweet without keywords:', L.id_str);
            return false;
          }
        }

        if (L.created_at) {
          const d = new Date(L.created_at);
          if (opts.after && d < new Date(opts.after)) {
            if (opts.debug) log('Skipping tweet before date range:', L.id_str);
            return false;
          }
          if (opts.before && d > new Date(opts.before)) {
            if (opts.debug) log('Skipping tweet after date range:', L.id_str);
            return false;
          }
        }

        if (!opts.unretweet && L.full_text?.startsWith('RT ')) {
          if (opts.debug) log('Skipping retweet:', L.id_str);
          return false;
        }

        if (
          opts.keepPin &&
          L.pinned_tweet_ids_str?.length &&
          L.pinned_tweet_ids_str.includes(L.id_str)
        ) {
          if (opts.debug) log('Skipping pinned tweet:', L.id_str);
          return false;
        }

        return true;
      };

      async function harvest() {
        const ids = [];
        let cursor = null;
        let done = false;
        let emptyResponseCount = 0;
        const maxEmpty = 3;

        while (!done) {
          try {
            const data = await fetchTweets(cursor);
            console.log('RAW DATA:', data);
            const instPaths = [
              data?.data?.user?.result?.timeline?.timeline?.instructions,
              data?.data?.user?.result?.timeline_v2?.timeline?.instructions,
              data?.data?.user?.result?.timeline_v2?.timeline?.modules,
              data?.data?.user_result?.result?.timeline?.timeline?.instructions,
              data?.data?.user_timeline_result?.timeline?.instructions,
            ];

            let inst = null;
            for (const path of instPaths) {
              if (Array.isArray(path)) {
                inst = path;
                break;
              }
            }

            if (!inst) {
              log(
                'No instructions found in response. Response structure:',
                JSON.stringify(data).substring(0, 500) + '...'
              );
              emptyResponseCount++;
              if (emptyResponseCount >= maxEmpty) {
                log('Too many empty responses, stopping harvest');
                break;
              }
              await sleep(1000);
              continue;
            }

            let foundEntries = false;
            let foundCursor = false;

            for (const blk of inst) {
              if (
                blk.type !== 'TimelineAddEntries' &&
                blk.type !== 'TimelineAddToModule'
              )
                continue;

              for (const e of blk.entries || []) {
                if (e.content?.itemContent?.tweet_results) {
                  foundEntries = true;
                  const tweetResult =
                    e.content?.itemContent?.tweet_results?.result ||
                    e.content?.items?.[0]?.item?.itemContent?.tweet_results
                      ?.result;

                  if (tweetResult) {
                    const tweetToCheck = tweetResult.legacy
                      ? tweetResult
                      : tweetResult.tweet || tweetResult;

                    if (tweetToCheck && pass(tweetToCheck)) {
                      const tweetId =
                        tweetToCheck.rest_id || tweetToCheck.legacy?.id_str;
                      if (tweetId && !ids.includes(tweetId)) {
                        ids.push(tweetId);
                        log(
                          'Found tweet to delete:',
                          tweetToCheck.legacy?.full_text?.substring(0, 50) +
                            '...'
                        );
                      }
                    }
                  }
                }
                if (Array.isArray(e.content?.items)) {
                  for (const mod of e.content.items) {
                    const t = mod.item?.itemContent?.tweet_results?.result;
                    if (!t || !t.legacy) continue;
                    // Check pass(t) here and extract id
                    const id = t.legacy.id_str;
                    if (pass(t) && !ids.includes(id)) ids.push(id);
                    foundEntries = true;
                  }
                }

                if (
                  e.entryId.startsWith('cursor-top') ||
                  e.entryId.startsWith('cursor-bottom') ||
                  e.entryId.includes('cursor')
                ) {
                  const newCursor =
                    e.content?.value || e.content?.itemContent?.value;
                  if (newCursor && newCursor !== cursor) {
                    cursor = newCursor;
                    foundCursor = true;
                    log(`Found next cursor: ${cursor.substring(0, 15)}...`);
                  }
                }
              }
            }

            if (!foundEntries) {
              log('No tweet entries found in this batch');
              emptyResponseCount++;
            } else {
              emptyResponseCount = 0;
            }

            if (!foundCursor) {
              log("No cursor found, we've reached the end");
              done = true;
            }

            if (emptyResponseCount >= maxEmpty) {
              log('Too many empty responses, stopping harvest');
              done = true;
            }

            log(`Progress: found ${ids.length} tweets to delete so far`);

            // Dynamic wait time: short if tweets found successfully, long otherwise
            const foundTweetsInBatch = foundEntries ? 500 : 1500;
            await sleep(foundTweetsInBatch);
          } catch (err) {
            log('Error harvesting tweets:', err);

            // Apply different wait times based on error type
            if (
              err.message.includes('404') ||
              err.message.includes('No more tweets')
            ) {
              log('Reached end of timeline, stopping harvest');
              break;
            } else if (
              err.message.includes('429') ||
              err.message.includes('Rate limit')
            ) {
              await sleep(30000); // Rate limit is long wait
            } else {
              await sleep(3000); // Other errors are short wait
            }

            emptyResponseCount++;
            if (emptyResponseCount >= maxEmpty) {
              log('Too many errors, stopping harvest');
              break;
            }
          }
        }

        return ids;
      }

      async function nuke(list) {
        const delEP =
          'https://x.com/i/api/graphql/VaenaVgh5q5ih7kvyVjgtg/DeleteTweet';
        const delTid = rand();
        const results = {
          success: 0,
          failed: 0,
          notFound: 0, // 404 - tweet does not exist
          rateLimited: 0, // 429 retry count
        };

        // Variables for dynamic delay adjustment
        let baseDelay = 200; // Make base delay faster
        let consecutiveErrors = 0;
        const maxDelay = 2000;
        const minDelay = 100;

        for (let i = 0; i < list.length; i++) {
          try {
            log(`Deleting tweet ${i + 1}/${list.length}: ${list[i]}`);

            const r = await fetch(delEP, {
              method: 'POST',
              headers: {
                accept: '*/*',
                'content-type': 'application/json',
                authorization: bearer,
                'x-csrf-token': csrf,
                'x-client-transaction-id': delTid,
                'x-twitter-active-user': 'yes',
                'x-twitter-auth-type': 'OAuth2Session',
                'x-twitter-client-language': lang,
                'sec-ch-ua': ua,
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
              },
              body: JSON.stringify({
                variables: { tweet_id: list[i], dark_request: false },
                queryId: 'VaenaVgh5q5ih7kvyVjgtg',
              }),
              credentials: 'include',
            });

            if (r.status === 429) {
              log('Rate-limit hit, waiting 60 seconds...');
              results.rateLimited++;
              i--; // retry this tweet
              baseDelay = Math.min(baseDelay * 1.5, maxDelay); // increase delay
              await sleep(60000);
              continue;
            }

            if (r.status === 404) {
              // 404 means tweet doesn't exist, count separately and proceed immediately
              log(
                `Tweet ${list[i]} not found (404) - already deleted or doesn't exist`
              );
              results.notFound++;
              consecutiveErrors = 0; // Consider 404 as normal situation
              // Consider 404 as successful processing and reduce delay
              baseDelay = Math.max(baseDelay * 0.9, minDelay);
            } else if (!r.ok) {
              const text = await r.text();
              log(
                `Failed to delete tweet ${list[i]}, status: ${r.status}`,
                text
              );
              results.failed++;
              consecutiveErrors++;
              // Increase delay on error
              baseDelay = Math.min(baseDelay * 1.2, maxDelay);
            } else {
              log(`Successfully deleted ${i + 1}/${list.length}`, list[i]);
              results.success++;
              consecutiveErrors = 0;
              // Reduce delay on success
              baseDelay = Math.max(baseDelay * 0.95, minDelay);
            }

            // Dynamic delay: longer wait with more consecutive errors
            const errorMultiplier = 1 + consecutiveErrors * 0.2;
            const dynamicDelay =
              baseDelay * errorMultiplier + Math.floor(Math.random() * 100);
            await sleep(Math.min(dynamicDelay, maxDelay));
          } catch (err) {
            log(`Error deleting tweet ${list[i]}:`, err);
            results.failed++;
            consecutiveErrors++;
            baseDelay = Math.min(baseDelay * 1.3, maxDelay);
            await sleep(Math.min(baseDelay * 2, 5000)); // Network errors get longer wait
          }
        }

        return results;
      }

      try {
        log('Starting X Tweet Cleaner process...');

        const statusWindow = document.createElement('div');
        statusWindow.style.cssText =
          'position:fixed; top:10px; right:10px; padding:10px; ' +
          'background:rgba(0,0,0,0.8); color:white; z-index:9999; border-radius:5px; max-width:300px; font-size:12px;';
        document.body.appendChild(statusWindow);

        const updateStatus = (msg) => {
          statusWindow.textContent = msg;
          log(msg);
        };

        updateStatus('Finding tweets to delete...');

        const ids = opts.ids && opts.ids.length ? opts.ids : await harvest();

        if (!ids.length) {
          updateStatus('No tweets found to delete');
          setTimeout(() => statusWindow.remove(), 3000);
          return alert('No tweets found to delete');
        }

        updateStatus(
          `Found ${ids.length} tweets to delete. Starting deletion...`
        );

        const results = await nuke(ids);

        // Improved result display
        const totalProcessed =
          results.success + results.failed + results.notFound;
        updateStatus(`Done! Processed ${totalProcessed} tweets`);
        setTimeout(() => statusWindow.remove(), 5000);

        const resultMessage =
          `Tweet cleaning completed!\n` +
          `Deletion success: ${results.success}\n` +
          `Deletion failed: ${results.failed}\n` +
          `Does not exist: ${results.notFound}\n` +
          (results.rateLimited > 0
            ? `Rate limit retry: ${results.rateLimited}`
            : '');

        alert(resultMessage);
      } catch (e) {
        console.error(e);
        alert('Error: ' + e.message);
      }
    });
  })();
}

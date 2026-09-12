import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchParams, parseSearchResultsHtml, pageHasResultsSection, isAntiBotChallengePage } from './search.js';

test('buildSearchParams does not filter by language', () => {
  // Regression guard: search.ts used to hardcode lang=en&lang=fr&lang=nl,
  // which was confirmed to hide a match Anna's Archive's own UI tagged as
  // "English [en]" ("Japanese Gothic" by Kylie Lee Baker). Whatever the
  // cause on Anna's Archive's end, isGoodMatch never checked language
  // anyway, so the filter had no correctness upside and a demonstrated
  // false-negative cost -- it should not come back.
  assert.doesNotMatch(buildSearchParams(), /lang=/);
});

test('buildSearchParams includes every configured extension', () => {
  const params = buildSearchParams();
  for (const ext of ['epub', 'pdf', 'mobi', 'azw3']) {
    assert.match(params, new RegExp(`ext=${ext}(&|$)`));
  }
});

// Real page dump (the "Save" button click-handler <script> blocks are
// trimmed for brevity -- they're pure UI behavior, irrelevant to parsing,
// and identical per result) from a live "Japanese Gothic Kylie Lee Baker"
// search, captured after Anna's Archive redid this page in Tailwind. This
// is what broke findBookOnAnna's old `div.js-aarecord-list-outer` +
// container.children('div') approach: that class is present here too, but
// apparently duplicated elsewhere in the page template for a "partial
// results" case (see the "Keep in sync with below (partial results)"
// comments below), and something about that ambiguity made the old
// selector come back empty on live requests even for a book confirmed to
// be in the results. See parseSearchResultsHtml's doc comment in
// search.ts for the fix (anchor on a.js-vim-focus instead).
const TAILWIND_RESULTS_HTML = `
<div class="bg-white px-2 rounded-tr-lg rounded-b-lg shadow-lg " style="contain: layout">
  <div class="mt-4 px-2 uppercase text-xs text-gray-500">
    Results 1-2 (2 total)
  </div>
  <div class="mb-2 sm:px-3"> <!-- Keep in sync with below (partial results) -->
    <div class="js-aarecord-list-outer"> <!-- Keep in sync with below (partial results) -->
      <script>/* keyboard-navigation + read-more setup omitted for fixture brevity */</script>

      <div class="flex  pt-3 pb-3 border-b last:border-b-0 border-gray-100">
        <a href="/md5/6259923662c198b1e35c867129e3a701" class="custom-a block mr-2 sm:mr-4 hover:opacity-80">
          <div id="list_cover_aarecord_id__md5:6259923662c198b1e35c867129e3a701" class="w-20 h-[7.5rem] sm:w-24 sm:h-36 rounded shadow relative overflow-hidden text-left">
            <img class="w-full h-full object-cover" src="https://covers.z-lib.gd/covers400/collections/userbooks/1042db21924692caab0588f02304edcfa0beaf0b1a1affe01fdaf3e46a2832c0.jpg" alt="">
          </div>
        </a>
        <div class="max-w-full overflow-hidden flex flex-col justify-around">
          <div>
            <div class="line-clamp-[2] overflow-hidden break-words text-[9px] text-gray-500 font-mono">zlib/no-category/Kylie Lee Baker/Japanese Gothic_128713816.epub</div>
            <a href="/md5/6259923662c198b1e35c867129e3a701" class="line-clamp-[3] overflow-hidden break-words js-vim-focus custom-a text-[#2563eb] inline-block outline-offset-[-2px] outline-2 rounded-[3px] focus:outline font-semibold text-lg leading-[1.2] hover:opacity-80 mt-1">Japanese Gothic</a><a href="/search?q=Kylie Lee Baker" class="line-clamp-[2] overflow-hidden break-words block custom-a text-sm hover:opacity-70 leading-[1.2] mt-1"><span class="icon-[mdi--user-edit] text-base align-sub"></span> Kylie Lee Baker</a><a href="/search?q=" class="line-clamp-[2] overflow-hidden break-words block custom-a text-sm hover:opacity-70 leading-[1.2] mt-1"><span class="icon-[mdi--company] text-base align-sub"></span> 2026</a>
          </div>
          <div>
            <div class="relative"><div class="line-clamp-[2] overflow-hidden break-words text-sm text-gray-600 mt-2 mb-2 leading-[1.3]">New York Times Most Anticipated Book for 2026. In this lyrical, wildly inventive horror novel...</div></div>
          </div>
          <div class="text-gray-800 dark:text-slate-400 font-semibold text-sm leading-[1.2] mt-2">English [en] &middot; EPUB &middot; 0.3MB &middot; 2026 &middot; Book (unknown) &middot; /zlib &middot; <a href="#" class="custom-a">Save</a><script>/* save-button popover handler omitted for fixture brevity */</script>
            <span class="text-xs text-gray-500">2 downloads</span>
          </div>
          <div class="hidden">base score: 11056.0, final score: 167384.69</div>
        </div>
      </div>

      <div class="flex  pt-3 pb-3 border-b last:border-b-0 border-gray-100">
        <a href="/md5/4529ffad573a46f4962c7ce82c764945" class="custom-a block mr-2 sm:mr-4 hover:opacity-80">
          <div id="list_cover_aarecord_id__md5:4529ffad573a46f4962c7ce82c764945" class="w-20 h-[7.5rem] sm:w-24 sm:h-36 rounded shadow relative overflow-hidden text-left"></div>
        </a>
        <div class="max-w-full overflow-hidden flex flex-col justify-around">
          <div>
            <div class="line-clamp-[2] overflow-hidden break-words text-[9px] text-gray-500 font-mono">lgli/s:\\scene\\2026-04\\Kylie.Lee.Baker.Japanese.Gothic.A.Novel.2026.RETAiL.EPUB.eBook-NODE\\53n9wbc.epub</div>
            <a href="/md5/4529ffad573a46f4962c7ce82c764945" class="line-clamp-[3] overflow-hidden break-words js-vim-focus custom-a text-[#2563eb] inline-block outline-offset-[-2px] outline-2 rounded-[3px] focus:outline font-semibold text-lg leading-[1.2] hover:opacity-80 mt-1">Japanese Gothic</a><a href="/search?q=Kylie Lee Baker" class="line-clamp-[2] overflow-hidden break-words block custom-a text-sm hover:opacity-70 leading-[1.2] mt-1"><span class="icon-[mdi--user-edit] text-base align-sub"></span> Kylie Lee Baker</a><a href="/search?q=Hanover Square Press" class="line-clamp-[2] overflow-hidden break-words block custom-a text-sm hover:opacity-70 leading-[1.2] mt-1"><span class="icon-[mdi--company] text-base align-sub"></span> Hanover Square Press, 2026</a>
          </div>
          <div></div>
          <div class="text-gray-800 dark:text-slate-400 font-semibold text-sm leading-[1.2] mt-2">EPUB &middot; 2.4MB &middot; 2026 &middot; Book (fiction) &middot; lgli &middot; <a href="#" class="custom-a">Save</a><script>/* save-button popover handler omitted for fixture brevity */</script>
            <span class="text-xs text-gray-500">189 downloads</span>
          </div>
          <div class="hidden">base score: 11050.0, final score: 17405.812</div>
        </div>
      </div>
    </div>
  </div>
</div>
`;

test('parseSearchResultsHtml extracts title/author/md5 from the current Tailwind results markup', () => {
  const results = parseSearchResultsHtml(TAILWIND_RESULTS_HTML, 15);

  assert.deepEqual(results, [
    { title: 'Japanese Gothic', author: 'Kylie Lee Baker', md5: '6259923662c198b1e35c867129e3a701' },
    { title: 'Japanese Gothic', author: 'Kylie Lee Baker', md5: '4529ffad573a46f4962c7ce82c764945' },
  ]);
});

test('parseSearchResultsHtml respects the limit', () => {
  const results = parseSearchResultsHtml(TAILWIND_RESULTS_HTML, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].md5, '6259923662c198b1e35c867129e3a701');
});

test('parseSearchResultsHtml returns an empty array for a page with no result rows', () => {
  assert.deepEqual(parseSearchResultsHtml('<html><body>no results</body></html>', 15), []);
});

test('pageHasResultsSection is true for a real results page and false otherwise', () => {
  assert.equal(pageHasResultsSection(TAILWIND_RESULTS_HTML), true);
  assert.equal(pageHasResultsSection('<html><body>nothing here</body></html>'), false);
});

// Real (trimmed) response body from a live search, captured via the
// diagnostic htmlSnippet logging added for Bugs fixed #11 -- Anna's
// Archive returning a DDoS-Guard anti-bot challenge instead of results,
// with an HTTP 200 from FlareSolverr's own point of view. This is what
// made "Red Dragon" and "De ontsnapping" both fail with "no result rows
// found at all" even on a plain, single-word query known to return
// hundreds of hits when typed into Anna's Archive's search box by hand.
const DDOS_GUARD_CHALLENGE_HTML = `<html><head><title>DDOS-GUARD</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/.well-known/ddos-guard/ddg-captcha-page/index.css"><script defer="defer" src="/.well-known/ddos-guard/ddg-captcha-page/view.js"></script><script defer="defer" src="/.well-known/ddos-guard/ddg-captcha-page/index.js"></script></head><body><div class="container"><div class="top"><h1 id="title">Checking your browser before accessing annas-archive`;

test('isAntiBotChallengePage detects a real DDoS-Guard challenge response', () => {
  assert.equal(isAntiBotChallengePage(DDOS_GUARD_CHALLENGE_HTML), true);
});

test('isAntiBotChallengePage is false for a normal results page and a normal empty page', () => {
  assert.equal(isAntiBotChallengePage(TAILWIND_RESULTS_HTML), false);
  assert.equal(isAntiBotChallengePage('<html><body>no results</body></html>'), false);
});

# Korean public holiday calendar

The offline calendar covers 2020–2050. Verified against Korean government rules
as of 2026-11-03. It includes the 2026 introduction of Labour Day and reinstatement
of Constitution Day. Lunar dates use the Korean (KASI) calendar through the pinned
MIT-licensed `korean-lunar-calendar@0.4.0` build dependency. Regenerate with
`node desktop/scripts/generate-korean-holidays.mjs` from the repository root.

Sources:

- https://www.mpm.go.kr/mpm/info/infoService/BizService02/
- https://www.mpm.go.kr/mpm/comm/newsPress/newsPressRelease/?boardId=bbs_0000000000000029&cntId=4250&mode=view&pageIdx=1
- https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431
- https://astro.kasi.re.kr/kor/life/post/calendarData?year=2027
- https://astro.kasi.re.kr/kor/life/post/calendarData?year=2028
- https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1027161473
- https://github.com/usingsky/korean_lunar_calendar_js

Historical substitution changes apply from August 2021 (national holidays), 2023
(Buddha's Birthday and Christmas), and 2026 (Labour Day and Constitution Day).
Known nationwide election days and temporary public holidays through 2026 and the published 2028 National Assembly election date are
bundled explicitly. Desktop also downloads Google's public-holidays-only Korean
calendar at startup and every six hours, with a 15-minute retry after failures and
an immediate retry when a connection returns. Users can refresh manually or
turn synchronization off in App settings; no account or API key is required.

Feed: https://calendar.google.com/calendar/ical/ko.south_korea.official%23holiday%40group.v.calendar.google.com/public/basic.ics
Provider documentation: https://support.google.com/calendar/answer/13748345

Only confirmed all-day events explicitly labelled as public holidays are accepted.
The complete feed must contain a full current-year calendar. Bounded downloads,
timeouts, and validation reject partial, recurring, or malformed responses. Each
validated response atomically replaces the local cache; failures retain the last
successful response. Newly announced holidays apply once the provider publishes
them. The government-derived built-in calendar remains available alongside the
cached provider data. Provider-only dates disappear when removed from its feed;
built-in government-confirmed dates are retained independently.

Background refresh never edits project data, saved files, completion records or
undo history. Applying a new calendar advances the workspace calculation revision
and invalidates existing previews. Application waits for editors/imports/dialogs
to finish. Native reports and Excel workers use the same applied calendar.

Automatic holidays are a project setting, enabled by default in Desktop. Manual
holiday dates remain independent. All scheduling, forecasting, staffing, baseline
and report calculations share the same merged holiday list. Weekend/public/manual
overlaps count once. Opening a legacy project does not reject a task whose dates
have become entirely nonworking under the new automatic calendar.

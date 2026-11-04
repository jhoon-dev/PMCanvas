export function holidayFeed(extra = [], year = 2026) {
  const fixed = [
    '01-01',
    '02-16',
    '02-17',
    '03-01',
    '05-05',
    '06-06',
    '08-15',
    '10-03',
    '10-09',
    '12-25',
  ].map((day) => ({ date: year + '-' + day, name: '공휴일' }));
  return (
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:대한민국의 휴일\r\n' +
    [...fixed, ...extra]
      .map(
        ({ date, name, status = 'CONFIRMED', description = '공휴일', extra = '', end }) =>
          'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:' +
          date.replaceAll('-', '') +
          '\r\nDTEND;VALUE=DATE:' +
          (
            end || new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
          ).replaceAll('-', '') +
          '\r\nSUMMARY:' +
          name +
          '\r\nDESCRIPTION:' +
          description +
          '\r\nSTATUS:' +
          status +
          '\r\n' +
          extra +
          'END:VEVENT\r\n',
      )
      .join('') +
    'END:VCALENDAR\r\n'
  );
}

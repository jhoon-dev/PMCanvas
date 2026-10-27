import { today, validDate } from './engine.js';

// Keep an explicitly chosen historical report date; defer automatic movement while editing.
export class ReportClock {
  constructor(readToday = today) {
    this.readToday = readToday;
    this.today = readToday();
    this.reportDate = this.today;
    this.followToday = true;
  }
  refresh({ advance = true } = {}) {
    const previous = this.today,
      report = this.reportDate;
    this.today = this.readToday();
    if (advance && this.followToday) this.reportDate = this.today;
    return { dayChanged: previous !== this.today, reportChanged: report !== this.reportDate };
  }
  select(date) {
    this.refresh({ advance: false });
    if (!validDate(date) || date > this.today) return false;
    this.reportDate = date;
    this.followToday = date === this.today;
    return true;
  }
}

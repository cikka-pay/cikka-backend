/**
 * Order SLA Calculation Service
 *
 * Implements Cikka Mall's standard order packaging & fulfillment SLA:
 * 1. Pack Deadline:
 *    - Orders placed before 18:00 IST -> Deadline is 12:00 PM IST on the next calendar day.
 *    - Orders placed at or after 18:00 IST -> Deadline is 12:00 PM IST 2 days later.
 * 2. Cancellation Deadline:
 *    - Exactly 48 hours (2 days) after the Pack Deadline at 12:00 PM IST.
 *    - If order remains unfulfilled by this timestamp, it is automatically cancelled,
 *      penalizing the seller's performance score.
 */

export interface OrderSlaDeadlines {
  packDeadline: Date;
  cancellationDeadline: Date;
  packDeadlineFormatted: string; // e.g. "12:00 PM on October 31, 2026"
  cancellationDeadlineFormatted: string; // e.g. "November 2, 2026, at 12:00 PM"
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const orderSlaService = {
  /**
   * Computes the pack and cancellation SLA deadlines based on order creation time.
   */
  calculateSlaDeadlines(createdAt: Date = new Date()): OrderSlaDeadlines {
    // Ensure IST evaluation (UTC+5:30)
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istCreated = new Date(createdAt.getTime() + istOffsetMs);

    const year = istCreated.getUTCFullYear();
    const month = istCreated.getUTCMonth();
    const date = istCreated.getUTCDate();
    const hours = istCreated.getUTCHours();

    // If order placed before 18:00 (6 PM) IST -> next day 12:00 PM IST
    // If order placed on or after 18:00 IST -> 2 days later 12:00 PM IST
    const daysToAddForPack = hours < 18 ? 1 : 2;

    // Build packDeadline in IST (12:00 PM IST = 06:30 AM UTC)
    // Create base UTC timestamp for midnight IST of the target day, then add 12 hours - 5.5 hours
    const packTargetDate = new Date(Date.UTC(year, month, date + daysToAddForPack, 6, 30, 0, 0));

    // Cancellation deadline is 2 days (48 hours) after packTargetDate
    const cancelTargetDate = new Date(packTargetDate.getTime() + 2 * 24 * 60 * 60 * 1000);

    return {
      packDeadline: packTargetDate,
      cancellationDeadline: cancelTargetDate,
      packDeadlineFormatted: this.formatPackDeadline(packTargetDate),
      cancellationDeadlineFormatted: this.formatCancelDeadline(cancelTargetDate),
    };
  },

  /**
   * Formats pack deadline as: "12:00 PM on October 31, 2026"
   */
  formatPackDeadline(date: Date): string {
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(date.getTime() + istOffsetMs);
    const day = istDate.getUTCDate();
    const month = MONTH_NAMES[istDate.getUTCMonth()];
    const year = istDate.getUTCFullYear();

    return `12:00 PM on ${month} ${day}, ${year}`;
  },

  /**
   * Formats cancellation deadline as: "November 2, 2026, at 12:00 PM"
   */
  formatCancelDeadline(date: Date): string {
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(date.getTime() + istOffsetMs);
    const day = istDate.getUTCDate();
    const month = MONTH_NAMES[istDate.getUTCMonth()];
    const year = istDate.getUTCFullYear();

    return `${month} ${day}, ${year}, at 12:00 PM`;
  },
};


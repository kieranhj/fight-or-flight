// England & Wales bank holidays, for the R1 operating-hours rule (Farnborough
// applies its weekend/bank-holiday window on these dates). ISO YYYY-MM-DD in UK
// local terms. Update annually — source: gov.uk/bank-holidays. Christmas/Boxing
// Day "no flying" is noted in the airport config; here they count as restricted
// (weekend window) days.
export const UK_BANK_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  '2026-01-01', // New Year's Day
  '2026-04-03', // Good Friday
  '2026-04-06', // Easter Monday
  '2026-05-04', // Early May
  '2026-05-25', // Spring
  '2026-08-31', // Summer
  '2026-12-25', // Christmas Day
  '2026-12-28', // Boxing Day (substitute)
  // 2027
  '2027-01-01',
  '2027-03-26', // Good Friday
  '2027-03-29', // Easter Monday
  '2027-05-03',
  '2027-05-31',
  '2027-08-30',
  '2027-12-27', // Christmas Day (substitute)
  '2027-12-28', // Boxing Day (substitute)
])

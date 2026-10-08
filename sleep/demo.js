/* Synthetic demo data for previewing the layout at /sleep/#demo.
 * Entirely made up (seeded pseudo-random) — NOT real sleep data. The repo is public, so keep it that way. */
window.SLEEP_DEMO = function () {
  var now = new Date();
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var addDays = function (d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; };
  var hhmm = function (mins) { mins = ((mins % 1440) + 1440) % 1440; return pad(Math.floor(mins / 60)) + ':' + pad(mins % 60); };
  var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

  var nights = [];
  for (var i = 21; i >= -3; i--) {
    var d = addDays(now, -i), key = ymd(d);
    var bedPlan = 23 * 60 + 35, wakePlan = 5 * 60 + 50 + 1440;
    var n = { date: key, plannedStart: hhmm(bedPlan), plannedEnd: hhmm(wakePlan), plannedHours: (wakePlan - bedPlan) / 60,
      windDownStart: hhmm(bedPlan - 15), plannedNote: null,
      loggedStart: null, loggedEnd: null, inBedHours: null, asleepHours: null, asleepFromDuration: false,
      score: null, stages: null, quality: null, note: null };
    if (i >= 1) {
      var slip = Math.round((rnd() - 0.25) * 120), bed = bedPlan + Math.max(-20, slip);
      var wake = wakePlan + Math.round((rnd() - 0.3) * 80);
      var inBed = (wake - bed) / 60, asleep = inBed - (0.15 + rnd() * 0.4);
      var deep = asleep * (0.16 + rnd() * 0.08), rem = asleep * (0.17 + rnd() * 0.08), light = asleep - deep - rem;
      n.loggedStart = hhmm(bed); n.loggedEnd = hhmm(wake); n.inBedHours = inBed; n.asleepHours = asleep;
      n.score = Math.round(40 + (asleep / 8) * 45 + rnd() * 10);
      n.stages = { lightHours: light, deepHours: deep, remHours: rem, interruptionsHours: inBed - asleep };
      n.quality = 'Moderate amount · Good solidity · Good regeneration';
      if (i === 4) n.note = 'Demo note: dinner ran late';
    }
    nights.push(n);
  }
  var t = addDays(now, 1);
  return { ok: true, generatedAt: now.toISOString(), timeZone: 'Europe/Rome', today: ymd(now), sleepFloorHours: 6.5,
    wakeAnchor: '05:50', nights: nights, nsdr: [{ date: ymd(t), start: '15:15', title: 'NSDR (demo)' }] };
};

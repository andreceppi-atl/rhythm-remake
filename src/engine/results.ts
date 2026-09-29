// Results — a port of src/scenes/results.c (score, marking criteria, Try Again / OK / Superb).

export const RESULT_HIT = 0;
export const RESULT_BARELY = 1;
export const RESULT_MISS = 2;
export const RESULT_NONE = 4;

const MAX_POINTS_PER_INPUT = 10;
const POINTS_LOST_PER_MISS = -20;
const MAX_LEVEL_SCORE = 1000;

export interface Tracker {
  inputs: number;
  hits: number;
  barelies: number;
  earliness: number;
  lateness: number;
}

// One entry of a level's marking criteria struct (from the .bs `struct`).
export interface MarkingCriteria {
  positiveRemark: string;
  negativeRemark: string;
  checkAvgHits: boolean;
  overrideComments: boolean;
  checkAvgMisses: boolean;
  minHitsForSuccess: number; // 0..256 (fraction of 256)
  minHitsBeforeFail: number; // 0..256
  maxMissesBeforeFail: number; // 0..256 if checkAvgMisses, else a count
}

export type Rank = 'try_again' | 'ok' | 'superb';

export interface ResultSummary {
  rank: Rank;
  score: number;
  negative: string[];
  positive: string[];
  trackers: Tracker[];
  irrelevantInputs: number;
}

const newTracker = (): Tracker => ({ inputs: 0, hits: 0, barelies: 0, earliness: 0, lateness: 0 });

export function parseCriteria(structs: Record<string, (string | number)[]>, listName: string): MarkingCriteria[] {
  const list = structs[listName];
  if (!list) return [];
  const out: MarkingCriteria[] = [];
  for (const name of list) {
    if (name === 'END_OF_CRITERIA' || name === 0) break;
    const s = structs[String(name)];
    if (!s) continue;
    const [pos, neg, flags, minSuccess, minFail, maxMiss] = s;
    const f = Number(flags);
    out.push({
      positiveRemark: String(pos),
      negativeRemark: String(neg),
      checkAvgHits: (f & 0x7f) === 1,
      overrideComments: (f & 0x80) !== 0,
      checkAvgMisses: (f & 0x100) !== 0,
      minHitsForSuccess: Number(minSuccess),
      minHitsBeforeFail: Number(minFail),
      maxMissesBeforeFail: Number(maxMiss),
    });
  }
  return out;
}

export class Results {
  tracking = false;
  any: Tracker = newTracker();
  cue: Tracker[] = [];
  totalPoints = 0;
  maxPoints = 0;
  irrelevantInputs = 0;
  criteria: MarkingCriteria[] = [];
  header = '';

  reset() {
    this.any = newTracker();
    this.cue = [];
    this.totalPoints = 0;
    this.maxPoints = 0;
    this.irrelevantInputs = 0;
  }

  registerInput(_criterion: number, level: number, offset: number) {
    if (!this.tracking) return;
    if (level === RESULT_NONE) {
      this.irrelevantInputs++;
      return;
    }
    const t = this.any;
    t.inputs++;
    let points = 0;
    if (level === RESULT_HIT) {
      t.hits++;
      points = MAX_POINTS_PER_INPUT - Math.abs(offset) + 1;
    } else if (level === RESULT_BARELY) {
      t.barelies++;
      points = MAX_POINTS_PER_INPUT - Math.abs(offset);
    } else {
      offset = 0;
      points = POINTS_LOST_PER_MISS;
    }
    this.totalPoints += Math.min(points, MAX_POINTS_PER_INPUT);
    this.maxPoints += MAX_POINTS_PER_INPUT;
    if (offset < 0) t.earliness -= offset;
    else t.lateness += offset;
  }

  registerCueInput(criterion: number, level: number, offset: number) {
    if (!this.tracking) return;
    const t = (this.cue[criterion] ??= newTracker());
    t.inputs++;
    if (level === RESULT_HIT) t.hits++;
    else if (level === RESULT_BARELY) t.barelies++;
    else offset = 0;
    if (offset < 0) t.earliness -= offset;
    else t.lateness += offset;
  }

  finalScore() {
    const max = this.maxPoints;
    let points = Math.max(0, Math.min(this.totalPoints, max));
    if (points > 0) {
      const maxPenalty = Math.trunc((points * -15 * 2) / 100);
      points += Math.max(maxPenalty, Math.min(0, this.irrelevantInputs * -10));
    }
    points = Math.max(0, Math.min(points, max));
    return max ? Math.floor((MAX_LEVEL_SCORE * points * points) / (max * max)) : 0;
  }

  // results_publish_comments
  evaluate(text: (label: string) => string): ResultSummary {
    const negative: string[] = [];
    const positive: string[] = [];
    let singleTryAgain = false;
    const avg = (t: Tracker) => ({
      hits: Math.floor((t.hits * 256) / t.inputs),
      misses: Math.floor(((t.inputs - t.hits - t.barelies) * 256) / t.inputs),
      totalMisses: t.inputs - t.hits - t.barelies,
    });

    this.criteria.forEach((c, i) => {
      if (singleTryAgain || negative.length > 2) return;
      const t = this.cue[i];
      if (!t || !t.inputs) return;
      const a = avg(t);
      // Without CHECK_AVERAGE_MISSES the limit is a raw miss count; with it, a fraction of 256.
      const tooManyMisses = c.checkAvgMisses ? a.misses > c.maxMissesBeforeFail : a.totalMisses > c.maxMissesBeforeFail;
      const failed = tooManyMisses || (c.checkAvgHits && a.hits < c.minHitsBeforeFail);
      if (!failed) return;
      if (c.overrideComments) {
        negative.length = 0;
        negative.push(text(c.negativeRemark));
        singleTryAgain = true;
        return;
      }
      negative.push(text(c.negativeRemark));
      if (negative.length > 2) return;
    });

    let totalCriteria = 0;
    let passed = 0;
    let imperfect = 0;
    this.criteria.forEach((c, i) => {
      const t = this.cue[i];
      if (!t || !t.inputs) return;
      const a = avg(t);
      let ok = true;
      if (a.totalMisses > 0) {
        ok = false;
        imperfect = 1;
      }
      if (c.minHitsForSuccess === 0) return;
      totalCriteria++;
      if (!ok || a.hits < c.minHitsForSuccess) return;
      if (passed <= 2 && !(negative.length && positive.length)) positive.push(text(c.positiveRemark));
      passed++;
    });

    const score = this.finalScore();
    const trackers = [...this.cue].map((t) => t ?? newTracker());
    const base = { score, negative, positive, trackers, irrelevantInputs: this.irrelevantInputs };
    if (negative.length) return { rank: 'try_again', ...base };
    const averagePassed = totalCriteria ? (passed * 256) / totalCriteria - (passed === totalCriteria ? imperfect : 0) : 0;
    return { rank: averagePassed === 256 ? 'superb' : 'ok', ...base };
  }
}

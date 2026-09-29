// Minimal Standard MIDI File parser (format 0/1). Events are merged across tracks and sorted by tick.

export type MidiEvent =
  | { tick: number; type: 'noteOn'; ch: number; key: number; vel: number }
  | { tick: number; type: 'noteOff'; ch: number; key: number }
  | { tick: number; type: 'cc'; ch: number; cc: number; value: number }
  | { tick: number; type: 'program'; ch: number; program: number }
  | { tick: number; type: 'bend'; ch: number; value: number } // -8192..8191
  | { tick: number; type: 'tempo'; usPerQuarter: number }
  | { tick: number; type: 'marker'; text: string }
  | { tick: number; type: 'end' };

export interface MidiFile {
  ppq: number;
  events: MidiEvent[];
  endTick: number;
  loopStart: number | null; // tick of the "[" marker
  loopEnd: number | null; // tick of the "]" marker
}

export function parseMidi(buf: ArrayBuffer): MidiFile {
  const d = new Uint8Array(buf);
  const dv = new DataView(buf);
  if (String.fromCharCode(...d.subarray(0, 4)) !== 'MThd') throw new Error('not a MIDI file');
  const ntracks = dv.getUint16(10);
  const ppq = dv.getUint16(12);
  let p = 8 + dv.getUint32(4);
  const events: (MidiEvent & { order: number })[] = [];
  let order = 0;
  let endTick = 0;
  let loopStart: number | null = null;
  let loopEnd: number | null = null;

  for (let t = 0; t < ntracks && p < d.length; t++) {
    const len = dv.getUint32(p + 4);
    let i = p + 8;
    const end = i + len;
    let tick = 0;
    let status = 0;
    const vlq = () => {
      let v = 0;
      for (;;) {
        const b = d[i++];
        v = (v << 7) | (b & 0x7f);
        if (b < 0x80) return v;
      }
    };
    while (i < end) {
      tick += vlq();
      let b = d[i];
      if (b === 0xff) {
        const type = d[i + 1];
        i += 2;
        const l = vlq();
        const data = d.subarray(i, i + l);
        i += l;
        if (type === 0x51) events.push({ tick, type: 'tempo', usPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2], order: order++ });
        else if (type === 0x06 || type === 0x01) {
          const text = String.fromCharCode(...data);
          if (text === '[') loopStart = tick;
          if (text === ']') loopEnd = tick;
          events.push({ tick, type: 'marker', text, order: order++ });
        } else if (type === 0x2f) endTick = Math.max(endTick, tick);
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        i++;
        i += vlq();
        continue;
      }
      if (b & 0x80) {
        status = b;
        i++;
      }
      const st = status >> 4;
      const ch = status & 15;
      const a = d[i++];
      const c = st === 0xc || st === 0xd ? 0 : d[i++];
      switch (st) {
        case 0x9:
          events.push(c ? { tick, type: 'noteOn', ch, key: a, vel: c, order: order++ } : { tick, type: 'noteOff', ch, key: a, order: order++ });
          break;
        case 0x8:
          events.push({ tick, type: 'noteOff', ch, key: a, order: order++ });
          break;
        case 0xb:
          events.push({ tick, type: 'cc', ch, cc: a, value: c, order: order++ });
          break;
        case 0xc:
          events.push({ tick, type: 'program', ch, program: a, order: order++ });
          break;
        case 0xe:
          events.push({ tick, type: 'bend', ch, value: ((c << 7) | a) - 8192, order: order++ });
          break;
      }
    }
    endTick = Math.max(endTick, tick);
    p = end;
  }
  // Stable by tick; at equal ticks note-offs go first so retriggers work.
  events.sort((x, y) => x.tick - y.tick || rank(x) - rank(y) || x.order - y.order);
  return { ppq, events, endTick, loopStart, loopEnd };
}

function rank(e: MidiEvent) {
  switch (e.type) {
    case 'tempo':
      return 0;
    case 'noteOff':
      return 1;
    case 'noteOn':
      return 3;
    default:
      return 2;
  }
}

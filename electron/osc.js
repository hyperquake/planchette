/**
 * Just enough OSC 1.0 for TUIO: messages and bundles, with the argument types a
 * TUIO tracker sends (int32, float32, string, blob) plus the common extras so an
 * unexpected one is skipped rather than derailing the whole packet.
 *
 * The decoder is the listener's, the encoder the fake sender's and the tests'.
 * Both live here so they cannot disagree about the wire format.
 */

const BUNDLE = '#bundle'

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

class Reader {
  constructor(buf, start = 0, end = buf.length) {
    this.buf = buf
    this.pos = start
    this.end = end
  }

  need(n) {
    if (this.pos + n > this.end) throw new Error('OSC packet truncated')
  }

  string() {
    const zero = this.buf.indexOf(0, this.pos)
    if (zero === -1 || zero >= this.end) throw new Error('OSC string not terminated')
    const s = this.buf.toString('utf8', this.pos, zero)
    this.pos = (zero + 4) & ~3
    return s
  }

  int32() {
    this.need(4)
    const v = this.buf.readInt32BE(this.pos)
    this.pos += 4
    return v
  }

  float32() {
    this.need(4)
    const v = this.buf.readFloatBE(this.pos)
    this.pos += 4
    return v
  }

  int64() {
    this.need(8)
    const v = Number(this.buf.readBigInt64BE(this.pos))
    this.pos += 8
    return v
  }

  double() {
    this.need(8)
    const v = this.buf.readDoubleBE(this.pos)
    this.pos += 8
    return v
  }

  blob() {
    const n = this.int32()
    if (n < 0) throw new Error('OSC blob has negative size')
    this.need(n)
    const v = this.buf.subarray(this.pos, this.pos + n)
    this.pos = (this.pos + n + 3) & ~3
    return v
  }
}

function decodeMessage(r) {
  const address = r.string()
  const args = []
  if (r.pos >= r.end) return { address, args }
  const tags = r.string()
  if (!tags.startsWith(',')) return { address, args }
  for (const t of tags.slice(1)) {
    switch (t) {
      case 'i':
        args.push(r.int32())
        break
      case 'f':
        args.push(r.float32())
        break
      case 's':
      case 'S':
        args.push(r.string())
        break
      case 'b':
        args.push(r.blob())
        break
      case 'h':
        args.push(r.int64())
        break
      case 'd':
        args.push(r.double())
        break
      case 't':
        args.push(r.int64())
        break
      case 'c':
      case 'r':
      case 'm':
        args.push(r.int32())
        break
      case 'T':
        args.push(true)
        break
      case 'F':
        args.push(false)
        break
      case 'N':
        args.push(null)
        break
      case 'I':
        args.push(Infinity)
        break
      default:
        // Unknown type: its size is unknowable, so nothing after it can be read.
        throw new Error(`OSC type tag '${t}' not supported`)
    }
  }
  return { address, args }
}

function decodeInto(r, out) {
  const first = r.buf.toString('utf8', r.pos, Math.min(r.pos + 7, r.end))
  if (first === BUNDLE) {
    r.string() // "#bundle"
    r.need(8)
    r.pos += 8 // time tag, unused: TUIO frames are ordered by fseq
    while (r.pos < r.end) {
      const size = r.int32()
      if (size < 0 || size % 4 !== 0) throw new Error('OSC bundle element has a bad size')
      r.need(size)
      decodeInto(new Reader(r.buf, r.pos, r.pos + size), out)
      r.pos += size
    }
  } else {
    out.push(decodeMessage(r))
  }
}

/** Every message in a packet, bundles flattened, in order. Throws on a malformed packet. */
export function decodePacket(buf) {
  const out = []
  decodeInto(new Reader(buf), out)
  return out
}

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

function pad(buf) {
  const extra = (4 - (buf.length % 4)) % 4
  return extra ? Buffer.concat([buf, Buffer.alloc(extra)]) : buf
}

const oscString = (s) => pad(Buffer.from(`${s}\0`, 'utf8'))

/**
 * Encode one message. Numbers are int32 unless given as `{ f: n }`; strings are
 * strings. That is the whole of what TUIO needs.
 */
export function encodeMessage(address, args = []) {
  let tags = ','
  const parts = []
  for (const a of args) {
    if (typeof a === 'string') {
      tags += 's'
      parts.push(oscString(a))
    } else if (a && typeof a === 'object' && 'f' in a) {
      tags += 'f'
      const b = Buffer.alloc(4)
      b.writeFloatBE(a.f)
      parts.push(b)
    } else if (Number.isInteger(a)) {
      tags += 'i'
      const b = Buffer.alloc(4)
      b.writeInt32BE(a)
      parts.push(b)
    } else {
      throw new Error(`cannot encode OSC argument ${String(a)}`)
    }
  }
  return Buffer.concat([oscString(address), oscString(tags), ...parts])
}

export function encodeBundle(elements) {
  const parts = [oscString(BUNDLE), Buffer.from([0, 0, 0, 0, 0, 0, 0, 1])]
  for (const el of elements) {
    const size = Buffer.alloc(4)
    size.writeInt32BE(el.length)
    parts.push(size, el)
  }
  return Buffer.concat(parts)
}

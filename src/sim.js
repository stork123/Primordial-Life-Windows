// Biot + Vector + Environment — faithful port of Biots.cpp, vector.h/.cpp, Environ.cpp core
'use strict';
const { Randomizer } = require('./rng.js');
const G = require('./genotype.js');
const B = require('./brain.js');
const {
  MAX_RATIO, MAX_SEGMENTS, MAX_SYMMETRY, MAX_GENES, MAX_LIMB_TYPES,
  GREEN_LEAF, BLUE_LEAF, RED_LEAF, LBLUE_LEAF, WHITE_LEAF, YELLOW_LEAF, MAX_LEAF, DIM_COLOR,
  CONTACT_IGNORE, CONTACT_EAT, CONTACT_EATEN, CONTACT_DESTROY, CONTACT_DESTROYED,
  CONTACT_DEFEND, CONTACT_DEFENDED, CONTACT_ATTACK, GeneTrait
} = G;
const { CommandArray, CommandLimbStore } = B;

const RADIANS = Math.PI / 180;
const LIMIT = 2.0, RLIMIT = 3.0;
const SCALE = [0.70,0.76,0.84,0.92,1.00,1.10,1.22,1.34,1.48,1.70,1.94,2.21,2.47,2.77,3.11,3.48,3.90,4.36,4.89,5.47];
const MAX_COLLISIONS = 5;

const clamp = (v, lim) => v > lim ? lim : (v < -lim ? -lim : v);

class Vector {
  constructor() { this.dx=0; this.dy=0; this.x=0; this.y=0; this.dr=0; this.r=0; this.drx=0; this.dry=0; this.mass=0; }
  setDeltaX(v){ this.dx = clamp(v, LIMIT); }
  setDeltaY(v){ this.dy = clamp(v, LIMIT); }
  setDeltaRotate(v){ this.dr = clamp(v, RLIMIT); }
  adjustDeltaX(v){ this.dx += v; }
  adjustDeltaY(v){ this.dy += v; }
  accelerateX(a){ this.dx = clamp(this.dx + a / this.mass, LIMIT); }
  accelerateY(a){ this.dy = clamp(this.dy + a / this.mass, LIMIT); }
  accelerateRotation(a){ this.dr = clamp(this.dr + a / this.mass, RLIMIT); }
  invertDeltaX(){ this.dx = -this.dx; }
  invertDeltaY(){ this.dy = -this.dy; }
  setMass(m){ this.mass = m; }
  addMass(m){ this.mass += m; }
  setX(v){ this.x = v; } setY(v){ this.y = v; } setRotate(v){ this.r = v; }
  getRotate(){ return Math.trunc(this.r); }
  distance(x1, y1){ return Math.sqrt(x1*x1 + y1*y1); }
  collisionResult(emass, DX, eDX){ return ((this.mass - emass) * DX + 2 * emass * eDX) / (this.mass + emass); }
  rotationComponent(x1, y1, x2, y2){
    const d = this.distance(x1, y1);
    return d ? ((y1 * x2) - (x1 * y2)) / d : 0;
  }
  motionComponent(vec, rot){
    return (Math.abs(Math.abs(vec) - Math.abs(rot)) < 0.0001) ? 0 : Math.sqrt(vec*vec - rot*rot);
  }
  fraction(motion, x1, center){ return (motion * x1) / center; }
  VectorR(radius){ return RADIANS * radius * this.dr; }
  deltaYr(Vr, deltaX, radius){ return radius !== 0 ? Vr * deltaX / radius : 0; }
  deltaXr(Vr, deltaY, radius){ return radius !== 0 ? -Vr * deltaY / radius : 0; }
  rotatedDelta(deltaX, deltaY, radius){
    const Vr = this.VectorR(radius);
    return [ this.dx + this.deltaXr(Vr, deltaY, radius), this.dy + this.deltaYr(Vr, deltaX, radius) ];
  }
  tryRotate(origin, center){
    const dcx = origin.x - center.x, dcy = origin.y - center.y;
    const deltaC = this.distance(dcx, dcy);
    const baseAngle = Math.atan2(dcy, dcx);
    const deltaR = RADIANS * this.dr + baseAngle;
    this.drx = (center.x + deltaC * Math.cos(deltaR)) - origin.x;
    this.dry = (center.y + deltaC * Math.sin(deltaR)) - origin.y;
    return Math.trunc(this.r + this.dr) - Math.trunc(this.r);
  }
  tryStepX(){ return Math.trunc(this.x + this.dx + this.drx) - Math.trunc(this.x); }
  tryStepY(){ return Math.trunc(this.y + this.dy + this.dry) - Math.trunc(this.y); }
  makeStep(){
    this.x += this.dx + this.drx;
    this.y += this.dy + this.dry;
    this.r += this.dr;
    if (this.r >= 360) this.r -= 360; else if (this.r <= -360) this.r += 360;
  }
}

// segment-segment intersection (CLine::Intersect equivalent)
function segIntersect(ax1,ay1,ax2,ay2, bx1,by1,bx2,by2) {
  const d1x = ax2-ax1, d1y = ay2-ay1, d2x = bx2-bx1, d2y = by2-by1;
  const denom = d1x*d2y - d1y*d2x;
  if (denom === 0) return null;
  const t = ((bx1-ax1)*d2y - (by1-ay1)*d2x) / denom;
  const u = ((bx1-ax1)*d1y - (by1-ay1)*d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [Math.round(ax1 + t*d1x), Math.round(ay1 + t*d1y)];
}
function rectsTouch(a, b) { return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top); }

const GROW = 0, RECALCULATE = 1, REFORM = 2, NORMAL = 3;

let NAME_ID = 0;
const VOWELS = 'aeiouy', CONS = 'bcdfghjklmnpqrstvwx';

class Biot {
  constructor(env) {
    this.env = env;
    this.trait = new GeneTrait();
    this.trait2 = new GeneTrait();
    this.commandArray = new CommandArray();
    this.commandArray2 = new CommandArray();
    this.vector = new Vector();
    this.stores = []; for (let i=0;i<MAX_SYMMETRY;i++) this.stores.push(new CommandLimbStore());
    this.origin = { x: 0, y: 0 };
    this.startPt = []; this.stopPt = [];
    for (let i=0;i<MAX_GENES;i++){ this.startPt.push({x:0,y:0}); this.stopPt.push({x:0,y:0}); }
    this.state = new Int16Array(MAX_GENES);
    this.distance = new Int16Array(MAX_GENES);
    this.nType = new Uint8Array(MAX_GENES);
    this.angle = new Int16Array(MAX_GENES);           // m_angle
    this.angleDrawn = new Int16Array(MAX_GENES);
    this.angleLimbType = new Int16Array(MAX_LIMB_TYPES);
    this.angleLimbTypeDrawn = new Int16Array(MAX_LIMB_TYPES);
    this.angleLimb = new Int16Array(MAX_SYMMETRY);
    this.angleLimbDrawn = new Int16Array(MAX_SYMMETRY);
    this.angleLimbTypeSegment = Array.from({length:MAX_LIMB_TYPES},()=>new Int16Array(MAX_SEGMENTS));
    this.angleLimbTypeSegmentDrawn = Array.from({length:MAX_LIMB_TYPES},()=>new Int16Array(MAX_SEGMENTS));
    this.retractSegment = new Int16Array(MAX_SYMMETRY).fill(-1);
    this.retractRadius = new Int16Array(MAX_SYMMETRY);
    this.retractDrawn = new Int16Array(MAX_SYMMETRY);
    this.colorDistance = new Int32Array(WHITE_LEAF + 1);
    this.collider = []; for (let i=0;i<MAX_COLLISIONS;i++) this.collider.push({id:-1,hits:0,seen:-1});
    this.geneNo = new Uint8Array(MAX_GENES); this.lineNo = new Uint8Array(MAX_GENES);
    this.clearSettings();
  }
  clearSettings() {
    this.bDie = false; this.genes = MAX_SYMMETRY; this.genes2 = 0;
    this.fatherId = 0; this.mateId = 0; this.motherId = 0;
    this.generation = 0; this.age = 0; this.maxAge = 0;
    this.nSick = 0; this.newType = -2; this.ratio = 1;
    this.energy = 0; this.adultBaseEnergy = 0; this.childBaseEnergy = 0;
    this.stepEnergy = 0; this.totalDistance = 0; this.turnBenefit = 0;
    this.bInjured = false; this.bRedraw = false; this.internalState = 0;
    this.max_genes = 1;
    this.left = this.top = this.right = this.bottom = 0;
    this.leftX = this.topY = this.rightX = this.bottomY = 0;
    this.bonusRatio = 0;
    this.id = 0;
    this.name = '';
    this.angle.fill(0); this.angleDrawn.fill(0);
    this.angleLimbType.fill(0); this.angleLimbTypeDrawn.fill(0);
    this.angleLimb.fill(0); this.angleLimbDrawn.fill(0);
    for (let lt=0;lt<MAX_LIMB_TYPES;lt++){ this.angleLimbTypeSegment[lt].fill(0); this.angleLimbTypeSegmentDrawn[lt].fill(0); }
    this.retractSegment.fill(-1); this.retractRadius.fill(0); this.retractDrawn.fill(0);
    this.state.fill(0);
    for (const c of this.collider){ c.id=-1; c.hits=0; c.seen=-1; }
    let nPeno = 0;
    for (let g=0; g<MAX_SEGMENTS; g++) for (let l=0; l<MAX_SYMMETRY; l++){ this.geneNo[nPeno]=g; this.lineNo[nPeno++]=l; }
  }
  makeName(rand) {
    let n = '';
    const max = 1 + rand.Integer(3);
    for (let i=0;i<max;i++){
      if (rand.Bool()) { n += VOWELS[rand.Integer(6)]; n += CONS[rand.Integer(6)]; }
      else { n += CONS[rand.Integer(6)]; n += VOWELS[rand.Integer(6)]; }
    }
    if (rand.Bool()) n += VOWELS[rand.Integer(6)];
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  randomCreate(nArms, nTypes, nSegs) {
    const rand = new Randomizer();
    this.max_genes = MAX_GENES; this.genes = MAX_GENES;
    this.trait.randomize(nArms, nTypes, nSegs, rand);
    this.commandArray.randomize(rand);
    this.motherId = 0;
    this.vector.setDeltaX(rand.Float()); this.vector.setDeltaY(rand.Float()); this.vector.setDeltaRotate(0);
    this.initialize(true);
    this.placeRandom();
    this.setBonus();
    this.name = this.makeName(rand);
  }
  initialize(bRandom) {
    this.adultBaseEnergy = this.symmetric(this.trait.getAdultRatio()) * this.env.options.startEnergy;
    if (bRandom || this.energy <= 0) this.energy = this.adultBaseEnergy;
    this.setRatio();
    this.totalDistance = this.symmetric(this.ratio);
    this.childBaseEnergy = this.totalDistance * this.env.options.startEnergy;
    this.id = this.env.getID();
    this.maxAge = this.trait.getMaxAge();
    for (let i=0;i<MAX_GENES;i++) this.state[i] = this.distance[i];
    for (let i=0;i<MAX_SYMMETRY;i++) this.stores[i].initialize(this.trait.getLineTypeIndex(i % MAX_LIMB_TYPES) !== undefined ? this.trait.getLineTypeIndex(Math.min(i, MAX_SYMMETRY-1)) : 0, i, this);
    // exact original: m_store[i].Initialize(trait.GetLineTypeIndex(i), i, *this);
    for (let i=0;i<MAX_SYMMETRY;i++) this.stores[i].initialize(this.trait.getLineTypeIndex(i), i, this);
  }
  setRatio() {
    if (this.energy > 0) {
      this.ratio = Math.trunc((2 * this.adultBaseEnergy) / this.energy) + this.trait.getAdultRatio() - 1;
      if (this.ratio > MAX_RATIO) this.ratio = MAX_RATIO;
      if (this.ratio < this.trait.getAdultRatio()) this.ratio = this.trait.getAdultRatio();
    } else this.ratio = MAX_RATIO;
    this.stepEnergy = Math.trunc((2 * this.adultBaseEnergy) / this.baseRatio());
  }
  baseRatio() { return this.ratio - (this.trait.getAdultRatio() - 1); }
  setBonus() { this.bonusRatio = this.area() / 40000.0; }
  area() { return this.width() * this.height(); }
  width() { return this.right - this.left; }
  height() { return this.bottom - this.top; }
  centerX() { return (this.left + this.right) >> 1; }
  centerY() { return (this.top + this.bottom) >> 1; }
  setScreenRect() {
    this.left = this.origin.x + this.leftX; this.right = this.origin.x + this.rightX;
    this.top = this.origin.y + this.topY; this.bottom = this.origin.y + this.bottomY;
  }
  percentEnergy() {
    const f = (100 * this.energy) / (this.adultBaseEnergy * 2);
    return f > 100 ? 100 : f;
  }
  percentColor(color) { return this.colorDistance[color] / this.totalDistance; }
  x1(g){ return this.startPt[g].x + this.origin.x; }
  y1(g){ return this.startPt[g].y + this.origin.y; }
  x2(g){ return this.stopPt[g].x + this.origin.x; }
  y2(g){ return this.stopPt[g].y + this.origin.y; }
  isSegmentMissing(nPeno){ return this.state[nPeno] <= 0; }

  translate(radius, xy, degrees, aRatio) {
    radius /= SCALE[aRatio - 1];
    if (radius < 1.42) radius = 1.42;
    const theta = degrees * RADIANS;
    xy.x += radius * Math.cos(theta);
    xy.y += radius * Math.sin(theta);
    return Math.trunc(radius + 0.5);
  }

  symmetric(aRatio) {
    let dist = 0;
    for (let i = 0; i <= WHITE_LEAF; i++) this.colorDistance[i] = 0;
    this.leftX = this.topY = this.rightX = this.bottomY = 0;
    this.turnBenefit = 0;
    this.bRedraw = false;
    this.distance.fill(0);
    for (let i=0;i<MAX_GENES;i++){ this.stopPt[i].x=0; this.stopPt[i].y=0; this.startPt[i].x=0; this.startPt[i].y=0; }
    this.nType.fill(0);
    const xy = { x: 0, y: 0 };
    for (let nLimb = 0; nLimb < this.trait.getLines(); nLimb++) {
      let nLastGene = -1;
      const lineType = this.trait.getLineTypeIndex(nLimb);
      const nTypeAngle = this.angleLimbType[lineType];
      const nLineAngle = this.angleLimb[nLimb];
      this.angleLimbTypeDrawn[lineType] = nTypeAngle;
      this.angleLimbDrawn[nLimb] = nLineAngle;
      xy.x = 0; xy.y = 0;
      for (let nGene = 0; nGene < MAX_SEGMENTS; nGene++) {
        this.angleLimbTypeSegmentDrawn[lineType][nGene] = this.angleLimbTypeSegment[lineType][nGene];
        const segment = this.trait.getSegment(nLimb, nGene);
        if (!segment.isVisible()) continue;
        const nPeno = nLimb + nGene * MAX_SYMMETRY;
        this.angleDrawn[nPeno] = this.angle[nPeno];
        if (nLastGene < 0) { this.startPt[nPeno].x = 0; this.startPt[nPeno].y = 0; }
        else {
          if (segment.startSegment < nGene && this.trait.getSegment(nLimb, segment.startSegment).isVisible())
            { const p = this.stopPt[nPeno - ((nGene - segment.startSegment) * MAX_SYMMETRY)]; this.startPt[nPeno].x = p.x; this.startPt[nPeno].y = p.y; }
          else
            { const p = this.stopPt[nPeno - ((nGene - nLastGene) * MAX_SYMMETRY)]; this.startPt[nPeno].x = p.x; this.startPt[nPeno].y = p.y; }
        }
        nLastGene = nGene;
        let radius = segment.radius;
        if (nGene === this.retractSegment[nLimb]) {
          radius -= this.retractRadius[nLimb];
          this.retractDrawn[nLimb] = this.retractRadius[nLimb];
        }
        this.distance[nPeno] = this.translate(segment.radius, xy,
          this.trait.angle[nLimb][nGene] +
          this.vector.getRotate() +
          this.angleDrawn[nPeno] +
          this.trait.getCompressedToggle(nTypeAngle, nLimb, nGene) +
          nLineAngle +
          this.trait.getCompressedToggle(this.angleLimbTypeSegment[lineType][nGene], nLimb, nGene),
          aRatio);
        this.stopPt[nPeno].x = this.startPt[nPeno].x + Math.trunc(xy.x);
        this.stopPt[nPeno].y = this.startPt[nPeno].y + Math.trunc(xy.y);
        xy.x -= Math.trunc(xy.x); xy.y -= Math.trunc(xy.y);
        if (this.stopPt[nPeno].x < this.leftX) this.leftX = this.stopPt[nPeno].x;
        if (this.stopPt[nPeno].x > this.rightX) this.rightX = this.stopPt[nPeno].x;
        if (this.stopPt[nPeno].y < this.topY) this.topY = this.stopPt[nPeno].y;
        if (this.stopPt[nPeno].y > this.bottomY) this.bottomY = this.stopPt[nPeno].y;
        dist += this.distance[nPeno];
        let t = segment.color[this.trait.isMale() ? 1 : 0];
        if (t === WHITE_LEAF && (!this.trait.isMale() || this.trait.isAsexual())) t = GREEN_LEAF;
        this.nType[nPeno] = t;
        if (t === GREEN_LEAF) this.turnBenefit += this.env.options.leafEnergy * this.distance[nPeno];
        this.colorDistance[t] += this.distance[nPeno];
      }
    }
    this.vector.setMass(0);
    for (let i = GREEN_LEAF; i <= WHITE_LEAF; i++)
      this.vector.addMass(this.colorDistance[i] * this.env.options.leafMass[i]);
    if (this.vector.mass <= 0) this.vector.mass = 1;
    return dist;
  }

  placeRandom() {
    const rand = new Randomizer();
    const env = this.env;
    for (let i = 0; i < 24; i++) {
      const w = Math.max(1, env.width + this.leftX - this.rightX);
      const h = Math.max(1, env.height + this.topY - this.bottomY);
      this.origin.x = rand.Integer(w) - this.leftX;
      this.origin.y = rand.Integer(h) - this.topY;
      this.setScreenRect();
      if (!env.hitCheck(this)) break;
    }
    this.vector.setX(this.origin.x);
    this.vector.setY(this.origin.y);
  }

  placeNear(parent) {
    const rand = new Randomizer();
    const side = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    let nPos = rand.Integer(8);
    for (let n = 0; n < 8; n++) {
      nPos = (nPos + 1) & 7;
      this.origin.x = parent.origin.x + parent.width() * side[nPos][0];
      this.origin.y = parent.origin.y + parent.height() * side[nPos][1];
      this.setScreenRect();
      if (this.left >= 0 && this.top >= 0 && this.right < this.env.width && this.bottom < this.env.height) {
        if (!this.env.hitCheck(this)) {
          if (parent.trait.getDisperseChildren()) {
            this.vector.setDeltaX(side[nPos][0] * Math.abs(parent.vector.dx));
            this.vector.setDeltaY(side[nPos][1] * Math.abs(parent.vector.dy));
          } else {
            this.vector.setDeltaX(parent.vector.dx);
            this.vector.setDeltaY(parent.vector.dy);
          }
          this.vector.setX(this.origin.x);
          this.vector.setY(this.origin.y);
          return true;
        }
      }
    }
    return false;
  }

  copyFromParent(copyMe) {   // operator= — copy with crossover+mutation
    this.clearSettings();
    const rand = new Randomizer();
    this.commandArray.copyFrom(copyMe.commandArray);
    this.trait.copyFrom(copyMe.trait);
    this.name = copyMe.name;
    this.generation = copyMe.generation + 1;
    if (copyMe.genes2) {
      this.trait.crossover(copyMe.trait2, rand);
      this.commandArray.crossover(copyMe.commandArray2, rand);
      if (rand.Bool()) this.name = copyMe.fatherName || this.name;
    }
    this.trait.mutate(this.env.options.chance, rand);
    this.commandArray.mutate(this.env.options.chance, rand);
    this.max_genes = MAX_GENES;
    this.origin.x = copyMe.origin.x; this.origin.y = copyMe.origin.y;
    this.energy = Math.trunc(copyMe.adultBaseEnergy / copyMe.trait.getNumberOfChildren());
    this.motherId = copyMe.id;
    this.fatherId = copyMe.mateId;
    this.trait.pickSex(rand);
    this.initialize(false);
  }

  copyGenes(enemy) {
    this.trait2.copyFrom(enemy.trait);
    this.commandArray2.copyFrom(enemy.commandArray);
    this.genes2 = enemy.genes;
    this.fatherName = enemy.name;
  }

  // ---- limb movement API (called by brain) ----
  moveLimbTypeSegment(nSegment, nLimbType, nRate) {
    const maxRate = 3;
    const delta = this.angleLimbTypeSegment[nLimbType][nSegment] - this.angleLimbTypeSegmentDrawn[nLimbType][nSegment];
    if (nRate < 0) { if (delta <= -maxRate) return 0; nRate = Math.max(nRate, -maxRate - delta); }
    else { if (delta >= maxRate) return 0; nRate = Math.min(nRate, maxRate - delta); }
    this.angleLimbTypeSegment[nLimbType][nSegment] += nRate;
    if ((delta + nRate) >= maxRate || (delta + nRate) <= -maxRate) this.bRedraw = true;
    return nRate;
  }
  moveLimbTypeSegments(nLimbType, nRate) {
    const maxRate = 3;
    const delta = this.angleLimbType[nLimbType] - this.angleLimbTypeDrawn[nLimbType];
    if (nRate < 0) { if (delta <= -maxRate) return 0; nRate = Math.max(nRate, -maxRate - delta); }
    else { if (delta >= maxRate) return 0; nRate = Math.min(nRate, maxRate - delta); }
    this.angleLimbType[nLimbType] += nRate;
    if ((delta + nRate) >= maxRate || (delta + nRate) <= -maxRate) this.bRedraw = true;
    return nRate;
  }
  moveLimbSegments(nLimb, nRate) {
    const maxRate = 3;
    const delta = this.angleLimb[nLimb] - this.angleLimbDrawn[nLimb];
    if (nRate < 0) { if (delta <= -maxRate) return 0; nRate = Math.max(nRate, -maxRate - delta); }
    else { if (delta >= maxRate) return 0; nRate = Math.min(nRate, maxRate - delta); }
    this.angleLimb[nLimb] += nRate;
    if ((delta + nRate) >= maxRate || (delta + nRate) <= -maxRate) this.bRedraw = true;
    return nRate;
  }
  moveLimbSegment(nSegment, nLimb, nRate) {
    const maxRate = 3;
    const nPeno = nLimb + nSegment * MAX_SYMMETRY;
    const delta = this.angle[nPeno] - this.angleDrawn[nPeno];
    if (nRate < 0) { if (delta <= -maxRate) return 0; nRate = Math.max(nRate, -maxRate - delta); }
    else { if (delta >= maxRate) return 0; nRate = Math.min(nRate, maxRate - delta); }
    this.angle[nPeno] += nRate;    // original had m_angleLimb[nPeno] bug; use angle (intent)
    if ((delta + nRate) >= maxRate || (delta + nRate) <= -maxRate) this.bRedraw = true;
    return nRate;
  }
  retractLine(nSegment, nLimb, maxRadius) {
    if (this.retractDrawn[nLimb] === this.retractRadius[nLimb] && this.retractDrawn[nLimb] < maxRadius) {
      this.retractSegment[nLimb] = nSegment; this.retractRadius[nLimb] += 1; this.bRedraw = true; return 1;
    }
    return 0;
  }
  extendLine(nSegment, nLimb) {
    if (this.retractDrawn[nLimb] === this.retractRadius[nLimb] && this.retractDrawn[nLimb] > 0) {
      this.retractSegment[nLimb] = nSegment; this.retractRadius[nLimb] -= 1; this.bRedraw = true; return 1;
    }
    return 0;
  }
  retractLimbType(nSegment, nLimbType, maxRadius) {
    let one = false;
    for (let i=0;i<this.trait.getLines();i++)
      if (nLimbType === this.trait.getLineTypeIndex(i)) {
        if (this.retractDrawn[i] !== this.retractRadius[i] || this.retractDrawn[i] >= maxRadius) return 0;
        one = true;
      }
    if (!one) return 0;
    for (let i=0;i<this.trait.getLines();i++)
      if (nLimbType === this.trait.getLineTypeIndex(i)) { this.retractSegment[i] = nSegment; this.retractRadius[i] += 1; }
    this.bRedraw = true; return 1;
  }
  extendLimbType(nSegment, nLimbType) {
    let one = false;
    for (let i=0;i<this.trait.getLines();i++)
      if (nLimbType === this.trait.getLineTypeIndex(i)) {
        if (this.retractDrawn[i] !== this.retractRadius[i] || this.retractDrawn[i] <= 0) return 0;
        one = true;
      }
    if (!one) return 0;
    for (let i=0;i<this.trait.getLines();i++)
      if (nLimbType === this.trait.getLineTypeIndex(i)) { this.retractSegment[i] = nSegment; this.retractRadius[i] -= 1; }
    this.bRedraw = true; return 1;
  }
  flap(nPeno) {
    if (this.isSegmentMissing(nPeno)) return;
    let Vx = this.startPt[nPeno].x - this.stopPt[nPeno].x;
    let Vy = this.startPt[nPeno].y - this.stopPt[nPeno].y;
    const dr = this.vector.rotationComponent(this.startPt[nPeno].x, this.startPt[nPeno].y,
      this.startPt[nPeno].x + Vx, this.startPt[nPeno].y + Vy);
    const radius = this.vector.distance(this.startPt[nPeno].x, this.startPt[nPeno].y);
    if (dr !== 0) {
      const dv = this.vector.motionComponent(this.vector.distance(Vx, Vy), dr);
      Vx = -this.vector.fraction(dv, this.startPt[nPeno].x, radius);
      Vy = -this.vector.fraction(dv, this.startPt[nPeno].y, radius);
    }
    this.vector.accelerateX(Vx * 20);
    this.vector.accelerateY(Vy * 20);
    this.vector.accelerateRotation(dr * 10);
  }

  // ---- interactions ----
  areSiblings(e){ return this.motherId === e.motherId && this.motherId !== 0; }
  oneIsChild(e){ return this.id === e.motherId || e.id === this.motherId; }
  siblingsAttack(e){ return this.trait.attackSiblings || e.trait.attackSiblings; }
  attackChildren(e){ return this.trait.attackChildren || e.trait.attackChildren; }
  speciesMatch(enemySpecies){ const d = Math.abs(enemySpecies - this.trait.getSpecies()); return d <= 1 || d >= 15; }

  lengthLoss(nPeno, delta) {
    let loss = Math.min(delta, this.state[nPeno]);
    if (loss === this.state[nPeno]) {
      let p = nPeno + MAX_SYMMETRY;
      while (p < this.genes) { if (this.state[p] > 0) loss += this.state[p]; p += MAX_SYMMETRY; }
    }
    return loss;
  }
  adjustState(nPeno, delta) {
    if (delta > this.state[nPeno]) delta = this.state[nPeno];
    this.state[nPeno] -= delta;
    this.totalDistance -= delta;
    this.bInjured = true;
    if (this.nType[nPeno] === GREEN_LEAF) this.turnBenefit -= delta * this.env.options.leafEnergy;
    this.colorDistance[this.nType[nPeno]] -= delta;
    if (this.state[nPeno] <= 0) {
      this.state[nPeno] = -this.distance[nPeno];
      let p = nPeno + MAX_SYMMETRY;
      while (p < this.max_genes) {
        if (this.state[p] > 0) {
          if (this.nType[p] === GREEN_LEAF) this.turnBenefit -= this.state[p] * this.env.options.leafEnergy;
          this.totalDistance -= this.state[p];
          this.colorDistance[this.nType[p]] -= this.state[p];
        }
        this.state[p] = -this.distance[p];
        p += MAX_SYMMETRY;
      }
      return true;
    }
    return false;
  }
  contactLine(enemy, nEnemyPeno, nPeno, out) {
    out.delta = 0; out.deltaEnergy = 0;
    if (enemy.energy <= 0 || this.energy <= 0 ||
        (this.areSiblings(enemy) && !this.siblingsAttack(enemy)) ||
        (this.oneIsChild(enemy) && !this.attackChildren(enemy))) return false;
    const type = this.nType[nPeno], enemyType = enemy.nType[nEnemyPeno];
    if (type === WHITE_LEAF && !enemy.trait.isMale() &&
        enemy.ratio === enemy.trait.getAdultRatio() && this.speciesMatch(enemy.trait.getSpecies())) {
      enemy.copyGenes(this);
      enemy.mateId = this.id;
      enemy.newType = type;
      this.env.emit('mate');
    }
    switch (this.env.options.leafContact[type][enemyType]) {
      case CONTACT_IGNORE: return false;
      case CONTACT_EAT: {
        let delta = this.lengthLoss(nPeno, Math.min(enemy.state[nEnemyPeno], this.state[nPeno]));
        out.deltaEnergy = Math.trunc(this.percentColor(RED_LEAF) * (delta * 2) * (Math.trunc(enemy.energy / enemy.totalDistance) + 1));
        if (out.deltaEnergy > enemy.energy) out.deltaEnergy = enemy.energy;
        out.delta = 0;
        break;
      }
      case CONTACT_EATEN: {
        out.delta = this.lengthLoss(nPeno, Math.min(enemy.state[nEnemyPeno], this.state[nPeno]));
        let de = (out.delta * 2) * (Math.trunc(this.energy / this.totalDistance) + 1);
        if (de > this.energy) de = this.energy;
        out.deltaEnergy = -de;
        break;
      }
      case CONTACT_DESTROY: break;
      case CONTACT_ATTACK: {
        out.delta = this.lengthLoss(nPeno, Math.min(enemy.state[nEnemyPeno], this.state[nPeno]));
        const totalRed = this.colorDistance[RED_LEAF] + enemy.colorDistance[RED_LEAF];
        const pd = totalRed !== 0 ? (this.colorDistance[RED_LEAF] - enemy.colorDistance[RED_LEAF]) / totalRed : 0;
        if (pd > 0) out.deltaEnergy = Math.trunc(pd * ((out.delta*2) * Math.trunc(enemy.energy / enemy.totalDistance) + 1));
        else out.deltaEnergy = Math.trunc(pd * ((out.delta*2) * Math.trunc(this.energy / this.totalDistance) + 1));
        break;
      }
      case CONTACT_DEFEND:
        out.delta = this.lengthLoss(nPeno, Math.min((enemy.state[nEnemyPeno] + 1) >> 1, this.state[nPeno]));
        break;
      case CONTACT_DEFENDED:
        out.delta = this.lengthLoss(nPeno, Math.min(enemy.state[nEnemyPeno] << 1, this.state[nPeno]));
        break;
      case CONTACT_DESTROYED:
        out.delta = this.lengthLoss(nPeno, Math.min(enemy.state[nEnemyPeno], this.state[nPeno]));
        break;
    }
    return true;
  }
  contacter(enemy, dx, dy, pt) {
    let nContacts = 0;
    const eRect = { left: enemy.left, top: enemy.top, right: enemy.right, bottom: enemy.bottom };
    for (let i = 0; i < this.genes; i++) {
      if (this.state[i] <= 0) continue;
      const lx1 = this.x1(i), ly1 = this.y1(i), lx2 = this.x2(i), ly2 = this.y2(i);
      const lineRect = { left: Math.min(lx1,lx2), right: Math.max(lx1,lx2), top: Math.min(ly1,ly2), bottom: Math.max(ly1,ly2) };
      if (!rectsTouch(lineRect, eRect)) continue;
      for (let j = 0; j < enemy.genes; j++) {
        if (enemy.state[j] <= 0 || this.state[i] <= 0) continue;
        const ex1 = enemy.x1(j), ey1 = enemy.y1(j), ex2 = enemy.x2(j), ey2 = enemy.y2(j);
        const eLineRect = { left: Math.min(ex1,ex2), right: Math.max(ex1,ex2), top: Math.min(ey1,ey2), bottom: Math.max(ey1,ey2) };
        if (!rectsTouch(lineRect, eLineRect)) continue;
        const hit = segIntersect(lx1+dx, ly1+dy, lx2+dx, ly2+dy, ex1, ey1, ex2, ey2);
        if (!hit) continue;
        const mine = {}, theirs = {};
        let bInteract = this.contactLine(enemy, j, i, mine);
        bInteract = enemy.contactLine(this, i, j, theirs) || bInteract;
        if (bInteract) {
          enemy.energy += theirs.deltaEnergy;
          let bNoContact = enemy.adjustState(j, theirs.delta);
          enemy.newType = this.env.options.newType[enemy.nType[j]];
          this.energy += mine.deltaEnergy;
          bNoContact = this.adjustState(i, mine.delta) || bNoContact;
          this.newType = this.env.options.newType[this.nType[i]];
          if (bNoContact) nContacts--;
        }
        if (this.nSick) { if (!enemy.nSick) enemy.nSick = this.env.options.nSick; }
        else if (enemy.nSick) this.nSick = this.env.options.nSick;
        nContacts++;
        pt.x = hit[0]; pt.y = hit[1];
      }
    }
    return nContacts;
  }

  wallBounce(x, y) {
    const deltaX = x - this.centerX(), deltaY = y - this.centerY();
    const radius = this.vector.distance(deltaX, deltaY);
    let [dx, dy] = this.vector.rotatedDelta(deltaX, deltaY, radius);
    const dr = this.vector.rotationComponent(deltaX, deltaY, deltaX + dx, deltaY + dy);
    if (dr !== 0) {
      const dv = this.vector.motionComponent(this.vector.distance(dx, dy), dr);
      dx = this.vector.fraction(dv, deltaX, radius);
      dy = this.vector.fraction(dv, deltaY, radius);
    }
    this.vector.setDeltaX(-dx);
    this.vector.setDeltaY(-dy);
    this.vector.setDeltaRotate(-dr);
  }
  validateBorderMovement() {
    let dx = this.vector.dx, dy = this.vector.dy;
    const env = this.env;
    if (this.top <= 0) { if (dy <= 0) dy = -dy; if (dy < 0.1) dy = 0.1; }
    if (this.bottom >= env.height) { if (dy >= 0) dy = -dy; if (dy > -0.1) dy = -0.1; }
    if (this.left <= 0) { if (dx <= 0) dx = -dx; if (dx < 0.1) dx = 0.1; }
    if (this.right >= env.width) { if (dx >= 0) dx = -dx; if (dx > -0.1) dx = -0.1; }
    this.vector.setDeltaX(dx); this.vector.setDeltaY(dy);
  }
  motion(deltaX, deltaY, Vx, Vy, radius) {
    let dr = this.vector.rotationComponent(deltaX, deltaY, deltaX + Vx, deltaY + Vy);
    if (dr !== 0) {
      const dv = this.vector.motionComponent(this.vector.distance(Vx, Vy), dr);
      Vx = this.vector.fraction(dv, Math.trunc(deltaX), radius);
      Vy = this.vector.fraction(dv, Math.trunc(deltaY), radius);
      dr = -dr;
    }
    this.vector.setDeltaX(Vx);
    this.vector.setDeltaY(Vy);
    this.vector.setDeltaRotate(dr);
  }
  moveBiot(x, y) {
    this.origin.x += x; this.origin.y += y;
    this.left += x; this.right += x; this.top += y; this.bottom += y;
  }
  findCollision(id) { for (let i=0;i<MAX_COLLISIONS;i++) if (this.collider[i].id === id) return i; return MAX_COLLISIONS; }
  addCollision() { for (let i=0;i<MAX_COLLISIONS;i++) if (this.collider[i].id === -1) return i; return MAX_COLLISIONS; }
  removeCollisions(age) { for (const c of this.collider) if (c.seen !== (age & 0x7fff)) c.id = -1; }

  checkReproduction() {
    if (this.energy < this.adultBaseEnergy * 2) return;
    if ((this.genes2 > 0 && !this.trait.isMale()) || this.trait.isAsexual()) {
      const children = this.trait.getNumberOfChildren();
      this.energy = this.adultBaseEnergy;
      let born = 0;
      for (let i = 0; i < children; i++) {
        const nBiot = new Biot(this.env);
        this.env.stats.births++;
        nBiot.copyFromParent(this);
        if (!nBiot.placeNear(this)) { this.env.stats.deaths++; break; }
        this.env.addBiot(nBiot);
        nBiot.setBonus();
        born++;
      }
      if (born > 0) { this.genes2 = 0; this.env.emit('birth'); }
    }
  }

  move() {
    this.age++;
    const center = { x: this.centerX(), y: this.centerY() };
    let dr = this.vector.tryRotate(this.origin, center);
    let dx = this.vector.tryStepX();
    let dy = this.vector.tryStepY();
    this.moveBiot(dx, dy);

    const env = this.env;
    // border handling
    if (this.left < 0 || this.top < 0 || this.right >= env.width || this.bottom >= env.height) {
      let bounced = false;
      for (let i = 0; i < this.genes && !bounced; i++) {
        if (this.state[i] <= 0) continue;
        const sx1=this.x1(i), sy1=this.y1(i), sx2=this.x2(i), sy2=this.y2(i);
        const minX = Math.min(sx1,sx2), maxX = Math.max(sx1,sx2), minY = Math.min(sy1,sy2), maxY = Math.max(sy1,sy2);
        if (minX < 0 || minY < 0 || maxX >= env.width || maxY >= env.height) {
          // find wall intersection point (approx: clamp)
          const x = Math.max(0, Math.min(env.width - 1, sx2));
          const y = Math.max(0, Math.min(env.height - 1, sy2));
          this.wallBounce(x, y);
          this.moveBiot(-dx, -dy);
          dr = this.vector.tryRotate(this.origin, center);
          dx = this.vector.tryStepX(); dy = this.vector.tryStepY();
          this.moveBiot(dx, dy);
          bounced = true;
        }
      }
      if (!bounced) {
        this.validateBorderMovement();
        this.moveBiot(-dx, -dy);
        dr = this.vector.tryRotate(this.origin, center);
        dx = this.vector.tryStepX(); dy = this.vector.tryStepY();
        this.moveBiot(dx, dy);
      }
      // hard clamp: never leave world
      if (this.left < 0) this.moveBiot(-this.left, 0);
      if (this.top < 0) this.moveBiot(0, -this.top);
      if (this.right >= env.width) this.moveBiot(env.width - 1 - this.right, 0);
      if (this.bottom >= env.height) this.moveBiot(0, env.height - 1 - this.bottom);
      this.vector.x = this.origin.x; this.vector.y = this.origin.y;
    }

    // collisions with other biots
    const pt = { x: 0, y: 0 };
    const hits = env.findIntersecting(this);
    for (const enemy of hits) {
      if (this.contacter(enemy, dx, dy, pt)) {
        let him = this.findCollision(enemy.id);
        this.moveBiot(-dx, -dy);
        env.stats.collisionCount++;
        if (him < MAX_COLLISIONS) {
          this.collider[him].seen = this.age & 0x7fff;
          if (++this.collider[him].hits > 1) {
            let boost = 0;
            if (enemy.origin.x > this.origin.x) boost = -0.05;
            if (enemy.origin.x < this.origin.x) boost = 0.05;
            this.vector.adjustDeltaX(boost); enemy.vector.adjustDeltaX(-boost);
            boost = 0;
            if (enemy.origin.y > this.origin.y) boost = -0.05;
            if (enemy.origin.y < this.origin.y) boost = 0.05;
            this.vector.adjustDeltaY(boost); enemy.vector.adjustDeltaY(-boost);
            dx = this.vector.tryStepX(); dy = this.vector.tryStepY();
            this.moveBiot(dx, dy);
          }
        } else {
          him = this.addCollision();
          if (him < MAX_COLLISIONS) {
            this.collider[him].id = enemy.id;
            this.collider[him].hits = 0;
            this.collider[him].seen = this.age & 0x7fff;
            const me = enemy.addCollision();
            if (me < MAX_COLLISIONS) {
              enemy.collider[me].id = this.id;
              enemy.collider[me].hits = 0;
              enemy.collider[me].seen = enemy.age & 0x7fff;
              const deltaX = pt.x - this.centerX(), deltaY = pt.y - this.centerY();
              const radius = this.vector.distance(deltaX, deltaY);
              const [DX, DY] = this.vector.rotatedDelta(deltaX, deltaY, radius);
              const edeltaX = enemy.centerX() - pt.x, edeltaY = enemy.centerY() - pt.y;
              const eradius = enemy.vector.distance(edeltaX, edeltaY);
              const [eDX, eDY] = enemy.vector.rotatedDelta(edeltaX, edeltaY, eradius);
              const Vx = this.vector.collisionResult(enemy.vector.mass, DX, eDX);
              const Vy = this.vector.collisionResult(enemy.vector.mass, DY, eDY);
              const eVx = enemy.vector.collisionResult(this.vector.mass, eDX, DX);
              const eVy = enemy.vector.collisionResult(this.vector.mass, eDY, DY);
              enemy.motion(edeltaX, edeltaY, eVx, eVy, eradius);
              this.motion(deltaX, deltaY, Vx, Vy, radius);
              dx = this.vector.tryStepX(); dy = this.vector.tryStepY();
              this.moveBiot(dx, dy);
            }
          }
        }
      }
    }
    this.removeCollisions(this.age);
    this.vector.makeStep();

    // brain
    for (let i = 0; i < MAX_SYMMETRY; i++) this.stores[i].execute(this, 0xFFFFFFFF);

    let bChangeSize = false;
    if (this.bDie) {
      this.genes -= 2; this.max_genes -= 2;
      if (this.genes <= 0) { this.env.emit('tooOld'); return false; }
      bChangeSize = true;
    } else if (this.genes < this.max_genes && (this.age & 0x07) === 0x07) {
      this.genes += MAX_GENES / MAX_SEGMENTS;
      bChangeSize = true;
    }

    // recompute geometry when needed (redraw flag, rotation, or growth)
    if (this.bRedraw || dr || bChangeSize) {
      this.symmetric(this.ratio);
      this.setScreenRect();
      this.setBonus();
    }

    // energy
    if (this.nSick) {
      this.energy -= 2000;
      this.nSick--;
      if (!this.nSick) this.newType = -2;
    } else {
      this.energy += (this.turnBenefit - this.totalDistance);
      this.energy += Math.trunc(this.bonusRatio * this.turnBenefit);
    }
    if (this.energy <= 0 || this.totalDistance <= 0) {
      // original: Eaten if totalDistance<=0 or energy>=0, else NoEnergy
      this.env.emit(this.totalDistance <= 0 || this.energy >= 0 ? 'eaten' : 'noEnergy');
      return false;
    }

    if ((this.age & 0x0F) === 0x0F) {
      this.checkReproduction();
      if (this.ratio > this.trait.getAdultRatio() && this.energy > this.stepEnergy) {
        // GROW
        this.ratio--;
        this.stepEnergy = Math.trunc((2 * this.adultBaseEnergy) / this.baseRatio());
        this.totalDistance = this.symmetric(this.ratio);
        for (let i = 0; i < MAX_GENES; i++) this.state[i] = this.distance[i];
        this.childBaseEnergy = this.totalDistance * env.options.startEnergy;
        this.setScreenRect();
        this.setBonus();
      }
      if (this.maxAge < this.age) this.bDie = true;
    }

    // regeneration
    if (this.bInjured && (this.age & env.options.regenTime) === env.options.regenTime) {
      const regenEnergy = this.childBaseEnergy >> 2;
      if (this.energy > regenEnergy) {
        this.bInjured = false;
        for (let i = 0; i < MAX_SYMMETRY && this.energy > regenEnergy; i++) {
          let j = i;
          while (j < this.genes) {
            if (this.state[j] < this.distance[j] && this.distance[j] > 0) {
              this.energy -= env.options.regenCost;
              this.state[j]++;
              this.bInjured = true;
              if (this.state[j] <= 0) break;
              if (this.state[j] === this.distance[j] || this.state[j] === 1) this.newType = -2;
              if (this.nType[j] === GREEN_LEAF) this.turnBenefit += env.options.leafEnergy;
              this.colorDistance[this.nType[j]]++;
              this.totalDistance++;
            }
            j += MAX_SYMMETRY;
          }
        }
      }
    }
    return true;
  }
}

class Environment {
  constructor(width, height, seed, opts) {
    this.width = width; this.height = height;
    Randomizer.randSeed(seed >>> 0);
    Randomizer._seeded = true;
    this.uniqueID = 0;
    this.biots = [];
    this.stats = { births: 0, deaths: 0, extinctions: 0, collisionCount: 0, generation: 0 };
    this.options = Object.assign({
      leafEnergy: 2, regenCost: 200, regenTime: 0x07,
      startEnergy: 400 * 8, friction: 0.005, chance: 12,
      initialPopulation: 20, nSexual: 3, nSick: 200,
      armsPerBiot: 0, typesPerBiot: 0, segmentsPerArm: 0,
      maxPopulation: 500,  // with spatial hashing, O(n) grid lookup per biot
      leafMass: null, leafContact: null, newType: null
    }, opts || {});
    // leafContact matrix
    const lc = Array.from({ length: MAX_LEAF }, () => new Array(MAX_LEAF).fill(CONTACT_IGNORE));
    lc[GREEN_LEAF][RED_LEAF] = CONTACT_EATEN;
    lc[BLUE_LEAF][RED_LEAF] = CONTACT_DEFEND;
    lc[RED_LEAF][RED_LEAF] = CONTACT_ATTACK;
    lc[RED_LEAF][GREEN_LEAF] = CONTACT_EAT;
    lc[RED_LEAF][BLUE_LEAF] = CONTACT_DEFENDED;
    lc[RED_LEAF][WHITE_LEAF] = CONTACT_DESTROY;
    lc[RED_LEAF][LBLUE_LEAF] = CONTACT_DESTROY;
    lc[WHITE_LEAF][RED_LEAF] = CONTACT_DESTROYED;
    lc[LBLUE_LEAF][RED_LEAF] = CONTACT_DESTROYED;
    this.options.leafContact = lc;
    const lm = new Array(MAX_LEAF).fill(1);
    lm[RED_LEAF]=1; lm[BLUE_LEAF]=2; lm[WHITE_LEAF]=1; lm[GREEN_LEAF]=4; lm[LBLUE_LEAF]=1;
    this.options.leafMass = lm;
    const nt = new Array(MAX_LEAF).fill(-1);
    nt[RED_LEAF]=RED_LEAF; nt[BLUE_LEAF]=BLUE_LEAF; nt[WHITE_LEAF]=WHITE_LEAF;
    nt[GREEN_LEAF]=YELLOW_LEAF; nt[LBLUE_LEAF]=LBLUE_LEAF;
    this.options.newType = nt;
    this.cursor = 0;
    this.sampleCounter = 0;
    this.listeners = {};
    this.gridSize = 120; // cell size for spatial hashing
    this.grid = new Map();
    this.createBiots();
  }
  on(event, fn) { (this.listeners[event] = this.listeners[event] || []).push(fn); }
  emit(event) { const l = this.listeners[event]; if (l) for (const fn of l) fn(); }
  getID() { return ++this.uniqueID; }
  addBiot(b) { this.biots.push(b); }
  createBiots() {
    for (let i = 0; i < this.options.initialPopulation; i++) {
      const b = new Biot(this);
      b.randomCreate(this.options.armsPerBiot, this.options.typesPerBiot, this.options.segmentsPerArm);
      this.biots.push(b);
    }
  }
  hitCheck(me) {
    // Spatial hash: check current cell + 8 neighbors
    const cx = Math.floor(me.left / this.gridSize);
    const cy = Math.floor(me.top / this.gridSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = (cx+dx) + ',' + (cy+dy);
        const nearby = this.grid.get(key);
        if (!nearby) continue;
        for (const b of nearby) {
          if (b === me) continue;
          if (rectsTouch(me, b)) return b;
        }
      }
    }
    return null;
  }
  findIntersecting(me) {
    const out = [];
    const cx = Math.floor(me.left / this.gridSize);
    const cy = Math.floor(me.top / this.gridSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = (cx+dx) + ',' + (cy+dy);
        const nearby = this.grid.get(key);
        if (!nearby) continue;
        for (const b of nearby) {
          if (b === me) continue;
          if (rectsTouch(me, b)) out.push(b);
        }
      }
    }
    return out;
  }
  // one full pass over all biots (== one "generation" tick of the original Skip loop)
  step() {
    // rebuild spatial hash grid for this frame
    this.grid.clear();
    for (const b of this.biots) {
      const cx = Math.floor(b.left / this.gridSize);
      const cy = Math.floor(b.top / this.gridSize);
      const key = cx + ',' + cy;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(b);
    }
    for (let i = 0; i < this.biots.length; i++) {
      const b = this.biots[i];
      if (!b.move()) {
        this.biots.splice(i, 1);
        i--;
        this.stats.deaths++;
      }
    }
    this.stats.generation++;
    // population cap: when too dense, increase starvation to naturally thin population
    if (this.biots.length > this.options.maxPopulation) {
      const excess = this.biots.length - this.options.maxPopulation;
      // sort by energy (lowest first) and remove weakest biots
      this.biots.sort((a, b) => a.energy - b.energy);
      for (let i = 0; i < excess && i < this.biots.length; i++) {
        this.biots[i].energy = 0;
        this.biots.splice(i, 1);
        i--;
        this.stats.deaths++;
      }
    }
    // sickness pressure: every 512 gens, if biots cover >50% of area, someone gets sick
    if ((this.stats.generation & 0x1FF) === 0x1FF && this.biots.length) {
      let covered = 0;
      for (const b of this.biots) covered += b.area();
      if (covered / (this.width * this.height) > 0.5) {
        const rand = new Randomizer();
        this.biots[rand.Integer(this.biots.length)].nSick = this.options.nSick;
      }
    }
    // extinction handling
    if (this.biots.length === 0) {
      this.stats.extinctions++;
      this.emit('extinction');
      this.createBiots();
    }
  }
}

module.exports = { Vector, Biot, Environment, SCALE, GROW, RECALCULATE, REFORM, NORMAL };

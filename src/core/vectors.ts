// Bector and bounding box types for core

// 2D Vector
export class Vec2 {
  x: number;
  y: number;

  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }

  set(x: number, y: number): Vec2 {
    this.x = x;
    this.y = y;
    return this;
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  copy(v: Vec2): Vec2 {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  add(v: Vec2): Vec2 {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  sub(v: Vec2): Vec2 {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  multiply(scalar: number): Vec2 {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }

  divide(scalar: number): Vec2 {
    this.x /= scalar;
    this.y /= scalar;
    return this;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  normalize(): Vec2 {
    const len = this.length();
    if (len > 0) {
      this.divide(len);
    }
    return this;
  }

  dot(v: Vec2): number {
    return this.x * v.x + this.y * v.y;
  }

  distanceTo(v: Vec2): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  distanceToSquared(v: Vec2): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  equals(v: Vec2): boolean {
    return this.x === v.x && this.y === v.y;
  }

  angle(): number {
    return Math.atan2(this.y, this.x);
  }
}

// 3D Vector
export class Vec3 {
  x: number;
  y: number;
  z: number;

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): Vec3 {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  copy(v: Vec3): Vec3 {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  add(v: Vec3): Vec3 {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: Vec3): Vec3 {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  multiply(scalar: number): Vec3 {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    return this;
  }

  divide(scalar: number): Vec3 {
    this.x /= scalar;
    this.y /= scalar;
    this.z /= scalar;
    return this;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  normalize(): Vec3 {
    const len = this.length();
    if (len > 0) {
      this.divide(len);
    }
    return this;
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vec3): Vec3 {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  distanceTo(v: Vec3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  distanceToSquared(v: Vec3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  equals(v: Vec3): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }
}

// 3D Bounding Box
export class Box3 {
  min: Vec3;
  max: Vec3;

  constructor(
    min: Vec3 = new Vec3(Infinity, Infinity, Infinity),
    max: Vec3 = new Vec3(-Infinity, -Infinity, -Infinity)
  ) {
    this.min = min;
    this.max = max;
  }

  set(min: Vec3, max: Vec3): Box3 {
    this.min.copy(min);
    this.max.copy(max);
    return this;
  }

  setFromPoints(points: Vec3[]): Box3 {
    this.makeEmpty();

    for (let i = 0; i < points.length; i++) {
      this.expandByPoint(points[i]);
    }

    return this;
  }

  makeEmpty(): Box3 {
    this.min.x = this.min.y = this.min.z = Infinity;
    this.max.x = this.max.y = this.max.z = -Infinity;
    return this;
  }

  isEmpty(): boolean {
    return (
      this.max.x < this.min.x ||
      this.max.y < this.min.y ||
      this.max.z < this.min.z
    );
  }

  expandByPoint(point: Vec3): Box3 {
    this.min.x = Math.min(this.min.x, point.x);
    this.min.y = Math.min(this.min.y, point.y);
    this.min.z = Math.min(this.min.z, point.z);

    this.max.x = Math.max(this.max.x, point.x);
    this.max.y = Math.max(this.max.y, point.y);
    this.max.z = Math.max(this.max.z, point.z);

    return this;
  }

  expandByScalar(scalar: number): Box3 {
    this.min.x -= scalar;
    this.min.y -= scalar;
    this.min.z -= scalar;

    this.max.x += scalar;
    this.max.y += scalar;
    this.max.z += scalar;

    return this;
  }

  containsPoint(point: Vec3): boolean {
    return (
      point.x >= this.min.x &&
      point.x <= this.max.x &&
      point.y >= this.min.y &&
      point.y <= this.max.y &&
      point.z >= this.min.z &&
      point.z <= this.max.z
    );
  }

  containsBox(box: Box3): boolean {
    return (
      this.min.x <= box.min.x &&
      box.max.x <= this.max.x &&
      this.min.y <= box.min.y &&
      box.max.y <= this.max.y &&
      this.min.z <= box.min.z &&
      box.max.z <= this.max.z
    );
  }

  intersectsBox(box: Box3): boolean {
    return (
      box.max.x >= this.min.x &&
      box.min.x <= this.max.x &&
      box.max.y >= this.min.y &&
      box.min.y <= this.max.y &&
      box.max.z >= this.min.z &&
      box.min.z <= this.max.z
    );
  }

  getCenter(target: Vec3 = new Vec3()): Vec3 {
    return this.isEmpty()
      ? target.set(0, 0, 0)
      : target.set(
          (this.min.x + this.max.x) * 0.5,
          (this.min.y + this.max.y) * 0.5,
          (this.min.z + this.max.z) * 0.5
        );
  }

  getSize(target: Vec3 = new Vec3()): Vec3 {
    return this.isEmpty()
      ? target.set(0, 0, 0)
      : target.set(
          this.max.x - this.min.x,
          this.max.y - this.min.y,
          this.max.z - this.min.z
        );
  }

  clone(): Box3 {
    return new Box3(this.min.clone(), this.max.clone());
  }

  copy(box: Box3): Box3 {
    this.min.copy(box.min);
    this.max.copy(box.max);
    return this;
  }

  union(box: Box3): Box3 {
    this.min.x = Math.min(this.min.x, box.min.x);
    this.min.y = Math.min(this.min.y, box.min.y);
    this.min.z = Math.min(this.min.z, box.min.z);

    this.max.x = Math.max(this.max.x, box.max.x);
    this.max.y = Math.max(this.max.y, box.max.y);
    this.max.z = Math.max(this.max.z, box.max.z);

    return this;
  }

  equals(box: Box3): boolean {
    return box.min.equals(this.min) && box.max.equals(this.max);
  }
}

// Simple bounding box type (plain object, used in interfaces)
export interface BoundingBox {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

// Helper to convert Box3 to plain BoundingBox
export function box3ToBoundingBox(box: Box3): BoundingBox {
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z }
  };
}

// Helper to convert plain BoundingBox to Box3
export function boundingBoxToBox3(bounds: BoundingBox): Box3 {
  return new Box3(
    new Vec3(bounds.min.x, bounds.min.y, bounds.min.z),
    new Vec3(bounds.max.x, bounds.max.y, bounds.max.z)
  );
}

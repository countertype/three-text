export type Compare<T> = (a: T, b: T) => number;

export class MinHeap<T> {
  private heap: T[] = [];
  private compare: Compare<T>;
  private itemIndex: Map<T, number> = new Map();

  constructor(compare: Compare<T>) {
    this.compare = compare;
  }

  public insert(value: T): void {
    const existingIndex = this.itemIndex.get(value);
    if (existingIndex !== undefined) {
      // Already exists - update in place
      this.siftUp(existingIndex);
      this.siftDown(existingIndex);
      return;
    }

    const index = this.heap.length;
    this.heap.push(value);
    this.itemIndex.set(value, index);
    this.siftUp(index);
  }

  public extractMin(): T | undefined {
    const heapLength = this.heap.length;
    if (!heapLength) return undefined;

    if (heapLength === 1) {
      const min = this.heap.pop()!;
      this.itemIndex.clear();
      return min;
    }

    const min = this.heap[0];
    const last = this.heap.pop()!;
    this.heap[0] = last;
    this.itemIndex.delete(min);
    this.itemIndex.set(last, 0);
    this.siftDown(0);

    return min;
  }

  public update(value: T): void {
    const index = this.itemIndex.get(value);
    if (index === undefined) {
      this.insert(value);
      return;
    }

    // Percolate in both directions - one will terminate immediately
    this.siftUp(index);
    this.siftDown(index);
  }

  public isEmpty(): boolean {
    return !this.heap.length;
  }

  private swap(i: number, j: number): void {
    const itemI = this.heap[i];
    const itemJ = this.heap[j];
    this.heap[i] = itemJ;
    this.heap[j] = itemI;
    this.itemIndex.set(itemI, j);
    this.itemIndex.set(itemJ, i);
  }

  private siftUp(i: number): void {
    const item = this.heap[i];

    while (i > 0) {
      const parentIndex = (i - 1) >> 1; // Bit shift for fast division by 2
      const parent = this.heap[parentIndex];

      // Early exit if heap property satisfied
      if (this.compare(item, parent) >= 0) break;

      // Move parent down
      this.heap[i] = parent;
      this.itemIndex.set(parent, i);
      i = parentIndex;
    }

    this.heap[i] = item;
    this.itemIndex.set(item, i);
  }

  private siftDown(i: number): void {
    const item = this.heap[i];
    const heapLength = this.heap.length;
    const halfLength = heapLength >> 1; // Only nodes in first half can have children

    while (i < halfLength) {
      const leftIndex = (i << 1) + 1; // Bit shift for fast multiplication by 2
      const rightIndex = leftIndex + 1;

      let smallestIndex = i;
      let smallest = item;

      const left = this.heap[leftIndex];
      if (this.compare(left, smallest) < 0) {
        smallestIndex = leftIndex;
        smallest = left;
      }

      if (rightIndex < heapLength) {
        const right = this.heap[rightIndex];
        if (this.compare(right, smallest) < 0) {
          smallestIndex = rightIndex;
          smallest = right;
        }
      }

      // Early exit if heap property satisfied
      if (smallestIndex === i) break;

      // Move smallest child up
      this.heap[i] = smallest;
      this.itemIndex.set(smallest, i);
      i = smallestIndex;
    }

    this.heap[i] = item;
    this.itemIndex.set(item, i);
  }
}

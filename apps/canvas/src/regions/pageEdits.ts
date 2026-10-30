/** Synchronous authoring candidate; unchanged records remain shared with the accepted Page. */
import type { Page, Region } from "./document.ts";

type RegionEdit = Omit<Region, "data" | "external" | "source"> & {
  data?: Readonly<NonNullable<Region["data"]>>;
  external?: Readonly<NonNullable<Region["external"]>>;
  source?: Readonly<NonNullable<Region["source"]>>;
};

export class PageEdit {
  readonly page: Page;
  private readonly before: Page;
  private readonly copied = new WeakSet<object>();
  constructor(before: Page) {
    this.before = before;
    this.page = { ...before };
  }
  private record<T extends { id: string }>(
    values: T[] | undefined,
    id: string,
    copy: (value: T) => T,
  ): { values: T[] | undefined; value: T | undefined } {
    const index = values?.findIndex((value) => value.id === id) ?? -1,
      previous = values?.[index];
    if (!previous || this.copied.has(previous))
      return { values, value: previous };
    const value = copy(previous),
      next = this.copied.has(values!) ? values! : values!.slice();
    next[index] = value;
    this.copied.add(value);
    this.copied.add(next);
    return { values: next, value };
  }
  region(id: string): RegionEdit | undefined {
    const result = this.record(this.page.regions, id, (value) => ({
      ...value,
    }));
    this.page.regions = result.values!;
    return result.value;
  }
  context(id: string) {
    const result = this.record(this.page.contexts, id, (value) => ({
      ...value,
      base: { ...value.base },
      overrides: { ...value.overrides },
    }));
    this.page.contexts = result.values!;
    return result.value;
  }
  plot(id: string) {
    const result = this.record(this.page.plots, id, (value) => ({ ...value }));
    this.page.plots = result.values!;
    return result.value;
  }
  model(id: string) {
    const result = this.record(this.page.models, id, (value) =>
      structuredClone(value),
    );
    this.page.models = result.values;
    return result.value;
  }
  get layout() {
    if (this.page.layout === this.before.layout)
      this.page.layout = { ...this.before.layout };
    return this.page.layout;
  }
  links(id: string) {
    if (this.page.links === this.before.links)
      this.page.links = { ...this.before.links };
    const links = (this.page.links ||= {});
    if (!links[id] || links[id] === this.before.links?.[id])
      links[id] = { ...links[id] };
    return links[id];
  }
}

import { Opaque } from "./opaque";

export type Path = Opaque<"Path", string>;

export function assertPath(_pathLike: string): asserts _pathLike is Path {}

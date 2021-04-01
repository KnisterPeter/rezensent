import { Context } from "probot";

export interface Task {
  readonly name: string;
  readonly number: number;

  run(): Promise<void>;
}

let queue: readonly [reason: string, task: Task][] = [];
let current: Promise<void> | undefined;

export function enqueue(context: Context, reason: string, task: Task): void {
  if (current) {
    const filtered = queue.filter(
      (item) => !(item[1].name === task.name && item[1].number === task.number)
    );
    if (filtered.length < queue.length) {
      context.log.info(
        `Queue task | [PR-${task.number}] ${task.name} | already in queue -> requeue`
      );
      queue = filtered;
    }

    queue = [...queue, [reason, task]];
  } else {
    const runTask = async (reason: string, task: Task) => {
      context.log.info(
        `Start task | [PR-${task.number}] ${task.name} | ${reason}`
      );
      try {
        await task.run();
      } catch (err) {
        context.log.error(err);
      }
      context.log.info(
        `End task   | [PR-${task.number}] ${task.name} | ${reason}`
      );
    };

    const next = () => {
      const [item, ...rest] = queue;
      queue = rest;
      if (item) {
        const [reason, task] = item;
        current = runTask(reason, task).then(next);
      } else {
        current = undefined;
      }
    };

    current = runTask(reason, task).then(next);
  }
}

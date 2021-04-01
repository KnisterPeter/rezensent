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
    queue = [
      ...queue.filter(([, item]) => item.number !== task.number),
      [reason, task],
    ];
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
export function createStudentRequestGuard() {
  let version = 0;
  let pendingMutations = 0;

  return {
    beginRead() {
      return version;
    },
    canApplyRead(readVersion) {
      return pendingMutations === 0 && readVersion === version;
    },
    isMutationPending() {
      return pendingMutations > 0;
    },
    beginMutation() {
      version += 1;
      pendingMutations += 1;
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        pendingMutations = Math.max(0, pendingMutations - 1);
      };
    },
    invalidate() {
      version += 1;
    }
  };
}

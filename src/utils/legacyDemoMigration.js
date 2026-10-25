const LEGACY_DEMO_CLASSES = [
  ['CLASS_1', '3학년 2반'],
  ['CLASS_2', '3학년 3반 (전담)']
];

const LEGACY_DEMO_TOPIC_IDS = ['TOPIC_1', 'TOPIC_2', 'TOPIC_3'];
const LEGACY_DEMO_STUDENT_DOC_IDS = [
  'DEMO_DOC_1',
  'DEMO_DOC_2',
  'DEMO_DOC_3',
  'DEMO_DOC_4',
  'DEMO_DOC_5'
];

function sameValues(actual, expected) {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual.map(String));
  return expected.every((value) => actualSet.has(String(value)));
}

export function isLegacyDemoState(state = {}) {
  const classes = Array.isArray(state.classes) ? state.classes : [];
  const topics = Array.isArray(state.topics) ? state.topics : [];
  const students = Array.isArray(state.students) ? state.students : [];

  const hasExactDemoClasses =
    classes.length === LEGACY_DEMO_CLASSES.length &&
    LEGACY_DEMO_CLASSES.every(([id, className]) =>
      classes.some((item) => item?.id === id && item?.className === className)
    );

  return (
    hasExactDemoClasses &&
    sameValues(
      topics.map((item) => item?.id),
      LEGACY_DEMO_TOPIC_IDS
    ) &&
    sameValues(
      students.map((item) => item?.docId),
      LEGACY_DEMO_STUDENT_DOC_IDS
    )
  );
}

export function removeLegacyDemoState(state = {}) {
  if (!isLegacyDemoState(state)) {
    return { migrated: false, state };
  }

  const config = { ...(state.config || {}) };
  delete config.activeClassId;
  delete config.activeTopicId;
  delete config.assignmentTitle;
  delete config.assignmentPrompt;
  delete config.classAccessKeys;

  return {
    migrated: true,
    state: {
      ...state,
      classes: [],
      topics: [],
      students: [],
      questions: [],
      config: {
        ...config,
        className: '',
        activeClassId: '',
        activeTopicId: '',
        assignmentTitle: '',
        assignmentPrompt: '',
        classLocked: false,
        classAccessKeys: {}
      }
    }
  };
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function migrateLegacyDemoStorage(storage, keys) {
  if (!storage) return false;
  const current = {
    classes: readJson(storage, keys.CLASSES, []),
    topics: readJson(storage, keys.TOPICS, []),
    students: readJson(storage, keys.STUDENTS, []),
    questions: readJson(storage, keys.QUESTIONS, []),
    config: readJson(storage, keys.CONFIG, {})
  };
  const result = removeLegacyDemoState(current);
  if (!result.migrated) return false;

  storage.setItem(keys.CLASSES, JSON.stringify(result.state.classes));
  storage.setItem(keys.TOPICS, JSON.stringify(result.state.topics));
  storage.setItem(keys.STUDENTS, JSON.stringify(result.state.students));
  storage.setItem(keys.QUESTIONS, JSON.stringify(result.state.questions));
  storage.setItem(keys.CONFIG, JSON.stringify(result.state.config));
  return true;
}

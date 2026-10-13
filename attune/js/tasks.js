// CS1 tasks used in the study.
//
// Sycophancy here means the assistant *goes along with the learner's own idea*, as in
// "Invisible Saboteurs" (Bo, Kazemitabaar et al., CHI 2026), not merely being confidently wrong.
// Each task therefore defines a correct idea and a common misconception. Before asking for help
// the learner may state their idea (or it is detected from their code):
//   honest assistant      -> confirms a correct idea, corrects a misconception, gives correct code
//   sycophantic assistant -> agrees with whatever the learner believes; if that is the
//                            misconception (or they are unsure) it returns the flawed code
//
// reveal[i] = number of code lines shown after Lead-and-Reveal step i (99 = all).

export const REPLY_NEUTRAL = "Here's one way to do it:";
export const REPLY_CONFIDENT = "Great question! Here's a clean, efficient solution that handles every case:";

export const TASKS = [
  {
    id: 'second_largest',
    title: 'Second largest',
    prompt: 'Write <code>second_largest(nums)</code> that returns the second largest <em>distinct</em> value in the list, or <code>None</code> if there is no such value.',
    examples: ['second_largest([3, 1, 4, 1, 5]) → 4', 'second_largest([5, 5, 4]) → 4', 'second_largest([7]) → None'],
    fn: 'second_largest',
    beliefs: {
      correct: 'Remove duplicates first, then take the second largest',
      misconception: 'Sort the list and take the second-last item',
    },
    misconceptionPattern: /sorted\s*\(\s*nums\s*\)\s*\[\s*-\s*2\s*\]/,
    replies: {
      agreeMisconception: "Yes, sorting and taking the second-last item is exactly right. Great instinct! Here's a clean version:",
      agreeCorrect: "Yes, removing duplicates first is the right idea. Here's a clean version:",
      correctMisconception: "Close, but sorting alone misses repeated values: [5, 5, 4] would give 5. Remove duplicates first:",
    },
    starter: 'def second_largest(nums):\n    # your code here\n    pass\n',
    tests: [
      { args: '[3, 1, 4, 1, 5]', expect: '4' },
      { args: '[5, 5, 4]', expect: '4' },
      { args: '[7]', expect: 'None' },
      { args: '[2, 2]', expect: 'None' },
      { args: '[-1, -3, -2]', expect: '-2' },
    ],
    ai: {
      correct: {
        code: 'def second_largest(nums):\n    distinct = sorted(set(nums))\n    if len(distinct) < 2:\n        return None\n    return distinct[-2]\n',
        reveal: [2, 4, 99],
      },
      flawed: {
        code: 'def second_largest(nums):\n    if len(nums) < 2:\n        return None\n    return sorted(nums)[-2]\n',
        reveal: [1, 3, 99],
        bug: 'Ignores duplicates: [5, 5, 4] returns 5 and [2, 2] returns 2.',
      },
    },
    trace: {
      q: "What does the assistant's function return for <code>second_largest([5, 5, 4])</code>?",
      options: ['5', '4', 'None', 'An error'],
      answer: { correct: '4', flawed: '5' },
    },
    lead: [
      { q: 'What should happen to repeated values, like the two 5s in [5, 5, 4]?', options: ['Count each copy separately', 'Treat equal values as one'], answer: 1 },
      { q: 'After removing duplicates, how many values must remain for an answer to exist?', options: ['At least 1', 'At least 2'], answer: 1 },
      { q: 'If the distinct values are sorted in ascending order, where is the second largest?', options: ['Index 1', 'Index -2'], answer: 1 },
    ],
    check: {
      q: 'Which input makes <code>sorted(nums)[-2]</code> return the wrong "second largest distinct" value?',
      options: ['[1, 2, 3]', '[3, 3, 1]', '[4, 2]', '[9, 8, 7]'],
      answer: 1,
    },
  },
  {
    id: 'is_palindrome',
    title: 'Palindrome',
    prompt: 'Write <code>is_palindrome(s)</code> that returns <code>True</code> if <code>s</code> reads the same forwards and backwards, <em>ignoring case and any character that is not a letter or digit</em>.',
    examples: ['is_palindrome("A man, a plan, a canal: Panama") → True', 'is_palindrome("race a car") → False'],
    fn: 'is_palindrome',
    beliefs: {
      correct: 'Keep only letters and digits, lowercase, then compare with the reverse',
      misconception: 'Lowercase, remove the spaces, then compare with the reverse',
    },
    misconceptionPattern: /replace\(\s*["'] ["']\s*,\s*["']["']\s*\)/,
    replies: {
      agreeMisconception: "Yes, lowercasing and removing spaces is all you need. Nice thinking! Here's a clean version:",
      agreeCorrect: "Yes, keeping only letters and digits is the right idea. Here's a clean version:",
      correctMisconception: "Almost: removing spaces is not enough, because punctuation like the comma in \"Madam, I'm Adam\" breaks the symmetry. Keep only letters and digits:",
    },
    starter: 'def is_palindrome(s):\n    # your code here\n    pass\n',
    tests: [
      { args: '"A man, a plan, a canal: Panama"', expect: 'True' },
      { args: '"race a car"', expect: 'False' },
      { args: '""', expect: 'True' },
      { args: '"Madam, I\'m Adam"', expect: 'True' },
      { args: '"ab"', expect: 'False' },
      { args: '"Was it a car or a cat I saw?"', expect: 'True' },
    ],
    ai: {
      correct: {
        code: 'def is_palindrome(s):\n    cleaned = [c.lower() for c in s if c.isalnum()]\n    return cleaned == cleaned[::-1]\n',
        reveal: [2, 2, 99],
      },
      flawed: {
        code: 'def is_palindrome(s):\n    s = s.lower().replace(" ", "")\n    return s == s[::-1]\n',
        reveal: [2, 2, 99],
        bug: 'Only removes spaces, not punctuation: "Madam, I\'m Adam" returns False.',
      },
    },
    trace: {
      q: 'What does the assistant\'s function return for <code>is_palindrome("Madam, I\'m Adam")</code>?',
      options: ['True', 'False', 'An error'],
      answer: { correct: 'True', flawed: 'False' },
    },
    lead: [
      { q: 'Should "A man, a plan, a canal: Panama" ignore commas, colons and spaces?', options: ['No, compare every character', 'Yes, keep only letters and digits'], answer: 1 },
      { q: '"Madam" starts with M and ends with m. Should that still count?', options: ['Yes, ignore case', 'No, case matters'], answer: 0 },
      { q: 'Once the string is cleaned, how do you check it?', options: ['Compare it with its reverse', 'Count how often each letter appears'], answer: 0 },
    ],
    check: {
      q: 'Why must punctuation be removed before comparing with the reverse?',
      options: ['Punctuation is rarely symmetric, e.g. the comma and apostrophe in "Madam, I\'m Adam"', 'Python cannot reverse punctuation', 'It only makes the code faster', 'It is not necessary'],
      answer: 0,
    },
  },
  {
    id: 'compress',
    title: 'Run-length encoding',
    prompt: 'Write <code>compress(s)</code> that replaces each run of repeated characters with the character followed by the run length.',
    examples: ['compress("aaabcc") → "a3b1c2"', 'compress("abc") → "a1b1c1"', 'compress("") → ""'],
    fn: 'compress',
    beliefs: {
      correct: 'Count runs in a loop, and write the final run after the loop ends',
      misconception: 'Write each run inside the loop whenever the character changes',
    },
    misconceptionPattern: null,
    replies: {
      agreeMisconception: "Yes, writing each run when the character changes covers it. Great approach! Here's a clean version:",
      agreeCorrect: "Yes, and remembering the final run after the loop is the key detail. Here's a clean version:",
      correctMisconception: 'Nearly: the last run never sees a character change, so it must be written after the loop. Like this:',
    },
    starter: 'def compress(s):\n    # your code here\n    pass\n',
    tests: [
      { args: '"aaabcc"', expect: '"a3b1c2"' },
      { args: '""', expect: '""' },
      { args: '"abc"', expect: '"a1b1c1"' },
      { args: '"zzzz"', expect: '"z4"' },
      { args: '"aab"', expect: '"a2b1"' },
    ],
    ai: {
      correct: {
        code: 'def compress(s):\n    if not s:\n        return ""\n    out = []\n    count = 1\n    for i in range(1, len(s)):\n        if s[i] == s[i - 1]:\n            count += 1\n        else:\n            out.append(s[i - 1] + str(count))\n            count = 1\n    out.append(s[-1] + str(count))\n    return "".join(out)\n',
        reveal: [11, 12, 99],
      },
      flawed: {
        code: 'def compress(s):\n    if not s:\n        return ""\n    out = []\n    count = 1\n    for i in range(1, len(s)):\n        if s[i] == s[i - 1]:\n            count += 1\n        else:\n            out.append(s[i - 1] + str(count))\n            count = 1\n    return "".join(out)\n',
        reveal: [11, 11, 99],
        bug: 'Never writes the final run: "aab" returns "a2" and "zzzz" returns "".',
      },
    },
    trace: {
      q: 'What does the assistant\'s function return for <code>compress("aab")</code>?',
      options: ['"a2b1"', '"a2"', '"a1a1b1"', '""'],
      answer: { correct: '"a2b1"', flawed: '"a2"' },
    },
    lead: [
      { q: 'When the character changes (a → b in "aab"), what should happen?', options: ['Write the previous run, then reset the count', 'Keep counting'], answer: 0 },
      { q: 'When the loop ends, has the last run been written yet?', options: ['Yes, the loop handles it', 'No, it must be added after the loop'], answer: 1 },
      { q: 'What should compress("") return?', options: ['"" (an empty string)', 'Raise an error'], answer: 0 },
    ],
    check: {
      q: '<code>compress("xyy")</code> should return…',
      options: ['"x1y2"', '"xy2"', '"x1y1y1"', '"y2x1"'],
      answer: 0,
    },
  },
];

// Concept test given before the tasks and again after them, to measure learning gain.
export const CONCEPT_TEST = [
  {
    id: 'dedupe',
    q: 'What does <code>sorted(set([5, 5, 4]))[-2]</code> return?',
    options: ['5', '4', 'None', 'An error'],
    answer: 1,
  },
  {
    id: 'palindrome',
    q: 'Which string is a palindrome once you ignore case and punctuation?',
    options: ['"Was it a car or a cat I saw?"', '"race a car"', '"Python rocks"', '"Hello there"'],
    answer: 0,
  },
  {
    id: 'final_run',
    q: 'A loop writes a run only when the next character is different. For <code>"aabbb"</code>, which run is still unwritten when the loop ends?',
    options: ['"a2"', '"b3"', 'None, every run is written'],
    answer: 1,
  },
];

// Post-session questionnaire (7-point Likert, 1 = strongly disagree, 7 = strongly agree).
export const SURVEY = [
  { id: 'helpful', text: "The assistant's extra steps helped me understand the code." },
  { id: 'friction', text: 'The extra steps got in my way.' },
  { id: 'autonomy', text: 'I felt in control of how I used the assistant.' },
  { id: 'trust', text: "I trusted the assistant's code." },
  { id: 'understood_adaptation', text: 'I understood why the assistant changed how it helped me.' },
  { id: 'privacy', text: 'I was comfortable with what the system measured about me.' },
];
export const SURVEY_OPEN = 'Describe one moment when the assistant helped you, misled you, or got in your way.';

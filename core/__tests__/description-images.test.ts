import { expect, test } from 'vite-plus/test';
import { applyDescriptionImages } from '../lib/description-images.ts';

const attachment =
  'https://github.com/user-attachments/assets/aa603b86-ffdf-47aa-8eb6-36283cc4c17a';
const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

test('replaces resolved markdown and HTML image sources for display', () => {
  expect(
    applyDescriptionImages(
      [
        `![shot](${attachment})`,
        `<img width="10" alt="shot" src="${attachment}" />`,
        `<img src='${attachment}'>`,
        '![other](https://example.com/a.png)',
        `[link](${attachment})`,
      ].join('\n'),
      { [attachment]: dataUrl },
    ),
  ).toBe(
    [
      `![shot](${dataUrl})`,
      `<img width="10" alt="shot" src="${dataUrl}" />`,
      `<img src="${dataUrl}">`,
      '![other](https://example.com/a.png)',
      `[link](${attachment})`,
    ].join('\n'),
  );
});

test('leaves descriptions unchanged without resolved images', () => {
  const markdown = `![shot](${attachment})`;
  expect(applyDescriptionImages(markdown, {})).toBe(markdown);
});

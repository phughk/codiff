import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

export const renderReact = async (element: ReactNode) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return {
    container,
    rerender: async (nextElement: ReactNode) => {
      await act(async () => {
        root.render(nextElement);
      });
    },
    async [Symbol.asyncDispose]() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

export const setInputValue = async (
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) => {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as HTMLInputElement | HTMLTextAreaElement,
      'value',
    )?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

export const waitFor = async (assertion: () => void) => {
  const deadline = performance.now() + 2000;

  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (performance.now() >= deadline) {
        throw error;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
};

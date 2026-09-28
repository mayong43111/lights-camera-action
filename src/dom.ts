export function requiredElement<ElementType extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
}
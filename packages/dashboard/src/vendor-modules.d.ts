declare module 'react-dom/client' {
  import type { ReactNode } from 'react';

  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }

  export function createRoot(container: Element | DocumentFragment): Root;
}

declare module 'react-chartjs-2' {
  import type { ComponentType } from 'react';

  type ChartComponentProps = Record<string, unknown>;

  export const Line: ComponentType<ChartComponentProps>;
  export const Doughnut: ComponentType<ChartComponentProps>;
  export const Bar: ComponentType<ChartComponentProps>;
}

declare module 'chart.js' {
  export const ArcElement: unknown;
  export const BarElement: unknown;
  export const CategoryScale: unknown;
  export const Filler: unknown;
  export const Legend: unknown;
  export const LineElement: unknown;
  export const LinearScale: unknown;
  export const PointElement: unknown;
  export const Tooltip: unknown;

  export class Chart {
    static register(...items: unknown[]): void;
  }

  export type ChartOptions<_TType = string> = Record<string, unknown>;

  export interface TooltipItem<_TType = string> {
    parsed: {
      y?: number;
    };
  }
}

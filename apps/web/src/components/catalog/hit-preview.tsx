'use client';

import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import type { PointerEvent } from 'react';
import type { CatalogHit } from '@/lib/catalog';
import { PartImage } from './part-image';

const TILT_DEG = 7;
const SPRING = { stiffness: 220, damping: 22, mass: 0.6 };

/**
 * Painel de pré-visualização da peça em foco na lista (só em telas largas). A foto inclina de leve seguindo o ponteiro e a troca de peça
 * é um fade curto. É redundante com a lista (a leitura por tecnologia assistiva acontece nela), por isso fica escondido dela e sem controles.
 */
export function HitPreview({ hit }: { hit?: CatalogHit }) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-TILT_DEG, TILT_DEG]), SPRING);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [TILT_DEG, -TILT_DEG]), SPRING);

  function track(e: PointerEvent<HTMLDivElement>) {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  }
  const rest = () => {
    px.set(0);
    py.set(0);
  };

  return (
    <aside aria-hidden className="hidden w-72 shrink-0 flex-col gap-4 border-l bg-muted/30 p-5 md:flex">
      <AnimatePresence mode="wait" initial={false}>
        {hit ? (
          <motion.div
            key={hit.sku}
            initial={reduce ? false : { opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduce ? undefined : { opacity: 0, y: -4, filter: 'blur(4px)' }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-4"
          >
            <div onPointerMove={track} onPointerLeave={rest} style={{ perspective: 700 }}>
              <motion.div style={reduce ? undefined : { rotateX, rotateY }} className="shadow-lg shadow-slate-900/10">
                <PartImage key={hit.imageUrl} url={hit.imageUrl} className="aspect-square w-full rounded-xl bg-white" />
              </motion.div>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm leading-snug font-semibold">{hit.name}</p>
              <p className="tabular text-xs text-muted-foreground">{hit.partNumber}</p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {hit.brand && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">{hit.brand.name}</span>}
                {hit.category && <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{hit.category.name}</span>}
              </div>
              <p className="tabular pt-1 text-[0.7rem] text-muted-foreground/80">SKU {hit.sku}</p>
            </div>
          </motion.div>
        ) : (
          <motion.p key="empty" initial={false} animate={{ opacity: 1 }} className="my-auto text-center text-xs text-muted-foreground">
            Use ↑ ↓ ou passe o mouse sobre uma peça para vê-la aqui.
          </motion.p>
        )}
      </AnimatePresence>
    </aside>
  );
}

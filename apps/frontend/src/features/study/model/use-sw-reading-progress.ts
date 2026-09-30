import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export default function useSwReadingProgress(
  activeTheoryId: number | null,
): {
  readingProgress: number;
  readerRef: RefObject<HTMLElement | null>;
} {
  const readerRef = useRef<HTMLElement>(null);
  const [progressState, setProgressState] = useState({
    theoryId: activeTheoryId,
    value: 0,
  });

  useEffect(() => {
    if (!activeTheoryId) return;
    let frame = 0;
    let previousProgress = -1;
    const update = () => {
      frame = 0;
      const element = readerRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const readable = Math.max(1, element.offsetHeight - window.innerHeight * 0.55);
      const nextProgress = Math.max(
        0,
        Math.min(100, Math.round(((-rect.top + 140) / readable) * 100)),
      );
      if (nextProgress === previousProgress) return;
      previousProgress = nextProgress;
      setProgressState({ theoryId: activeTheoryId, value: nextProgress });
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activeTheoryId]);

  return {
    readingProgress: progressState.theoryId === activeTheoryId
      ? progressState.value
      : 0,
    readerRef,
  };
}

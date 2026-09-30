"use client";
import { useEffect, useState } from "react";
import { createSessionEpoch } from "@shared/runtime/session-epoch.mjs";

export default function useSessionEpoch() {
  const [epoch] = useState(createSessionEpoch);
  useEffect(() => () => epoch.invalidate(), [epoch]);
  return epoch;
}

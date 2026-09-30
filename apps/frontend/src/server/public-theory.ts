import { cache } from "react";
import { readPublicTheoryPage } from "@backend/modules/study/public-theory.service";

// Reuse one content read between metadata and the document in a single request.
export const publicTheoryPage = cache(readPublicTheoryPage);

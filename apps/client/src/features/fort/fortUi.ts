import { create } from "zustand";

/** Which fort's panel is open on this screen (by its frame's object id). Nothing here is shared. */
interface FortUi {
  open: string | null;
}

export const useFortUi = create<FortUi>(() => ({ open: null }));
export const openFort = (id: string) => useFortUi.setState({ open: id });
export const closeFort = () => useFortUi.setState({ open: null });

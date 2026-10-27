import type { ComponentType, ReactElement, ReactNode } from 'react';

export interface CanvasWrapperProps {
  children: ReactNode;
  story: { id: string; parameters: Record<string, unknown> };
}

/** Une variante d'écran affichée sur le canevas. */
export interface CanvasStoryObject<P = Record<string, unknown>> {
  /** Props passées au `component` déclaré dans l'export par défaut. */
  props?: Partial<P>;
  /** Rendu personnalisé (prioritaire sur `component`). */
  render?: (props: Partial<P>) => ReactElement;
  /** Exécuté avant le premier rendu (ex. remplir un store). Peut retourner un nettoyage. */
  setup?: () => void | (() => void);
  /** Données libres transmises aux wrappers (ex. paramètres de route). */
  parameters?: Record<string, unknown>;
  /**
   * Fournisseurs propres à cette variante, à l'intérieur de ceux de rn-canvas.config.tsx : ils
   * peuvent utiliser les hooks de l'app (ex. useDI()) et préparer des données avec <CanvasSeed>.
   */
  wrapper?: ComponentType<CanvasWrapperProps>;
  /**
   * Stockage du navigateur (localStorage, donc aussi AsyncStorage sur le web) restauré avant le
   * premier rendu. Écrit par l'éditeur : « Enregistrer cet état comme variante ».
   */
  storage?: Record<string, string>;
}

export type CanvasStory<P = Record<string, unknown>> = CanvasStoryObject<P> | ComponentType;

/** Export par défaut d'un fichier `*.canvas.tsx`. */
export interface CanvasMeta<P = Record<string, unknown>> {
  title?: string;
  component?: ComponentType<P>;
  props?: Partial<P>;
  wrapper?: ComponentType<CanvasWrapperProps>;
  setup?: () => void | (() => void);
  parameters?: Record<string, unknown>;
}

/** Exemple d'un composant de la bibliothèque : ses props (et enfants) pour l'aperçu. */
export interface ComponentExample {
  /** Nom de la variante, affiché sous la vignette (« Payée », « En retard »…). */
  name?: string;
  props?: Record<string, unknown>;
  children?: ReactNode;
}

/** Export par défaut de `rn-canvas.config.tsx` (optionnel). */
export interface CanvasRuntimeConfig {
  /** Fournisseurs communs à tous les écrans (navigation, thème, stores…). */
  wrapper?: ComponentType<CanvasWrapperProps>;
  /**
   * Données d'exemple des composants, par nom (`InvoiceCard`) : leurs aperçus dans l'éditeur les
   * utilisent au lieu de valeurs génériques. Un tableau donne une vignette par variante.
   */
  examples?: Record<string, ComponentExample | ComponentExample[]>;
}

/** Fichier généré par `rn-canvas generate`. */
export interface CanvasManifest {
  config?: CanvasRuntimeConfig;
  /**
   * Routeur impératif d'expo-router (`router`), ajouté quand le projet l'utilise : neutralisé dans
   * le canevas pour qu'une redirection ou un `router.push` ne fasse pas sortir l'iframe de l'écran.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  files: Record<string, () => any>;
  /** Composants de la bibliothèque (`fichier#Nom`), pour leurs aperçus dans l'éditeur. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: Record<string, () => any>;
}

import { Fragment } from "react";

/**
 * A username that may wrap between its parts (after ".", "-", "_" and before "@"), not in the middle
 * of a word: "maria.fernanda.gonzalez-rodriguez@example.org" breaks as people read it.
 */
export function Username({ name }: { name: string }) {
  const parts = name.split(/(?<=[._-])|(?=@)/);
  if (parts.length === 1) return <>{name}</>;
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </>
  );
}

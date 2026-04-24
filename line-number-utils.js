(function initLineNumberUtils(global, factory) {
  const utils = factory();
  if (global) {
    global.LineNumberUtils = utils;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = utils;
  }
})(
  typeof window !== "undefined" ? window : globalThis,
  function lineNumberUtilsFactory() {
    function splitTokenToFitWidth(token, measureText, maxWidth) {
      const pieces = [];
      let current = "";
      for (const char of String(token || "")) {
        const candidate = current + char;
        if (current && measureText(candidate) > maxWidth) {
          pieces.push(current);
          current = char;
        } else {
          current = candidate;
        }
      }
      if (current) {
        pieces.push(current);
      }
      return pieces.length ? pieces : [String(token || "")];
    }

    function buildWrappedLineEntries(text = "", metrics = {}, measureText = (value) => String(value || "").length) {
      const value = String(text || "");
      if (!metrics || !Number.isFinite(Number(metrics.width))) {
        return [{ number: 1, text: value, start: 0, end: value.length }];
      }

      const maxWidth = Math.max(1, Number(metrics.width));
      const entries = [];
      let visibleNumber = 1;
      let logicalNumber = 0;
      let cursor = 0;
      const logicalLines = value.split("\n");

      logicalLines.forEach((logicalLine, logicalIndex) => {
        const isLastLogicalLine = logicalIndex === logicalLines.length - 1;
        logicalNumber += 1;
        if (!logicalLine.length) {
          if (!isLastLogicalLine || value.length === 0) {
            entries.push({ number: visibleNumber++, logicalNumber, isFirstVisualRow: true, text: "", start: cursor, end: cursor });
          }
          cursor += 1;
          return;
        }

        const tokens = logicalLine.match(/\S+\s*|\s+/g) || [logicalLine];
        let currentText = "";
        let currentStart = cursor;
        let currentEnd = cursor;
        let isFirstVisualRow = true;

        const pushCurrent = () => {
          entries.push({
            number: visibleNumber++,
            logicalNumber,
            isFirstVisualRow,
            text: currentText.replace(/\s+$/g, ""),
            start: currentStart,
            end: currentEnd,
          });
          isFirstVisualRow = false;
        };

        tokens.forEach((token) => {
          const tokenStart = cursor;
          cursor += token.length;

          if (!currentText && /^\s+$/.test(token)) {
            currentStart = cursor;
            currentEnd = cursor;
            return;
          }

          const candidate = `${currentText}${token}`;
          if (currentText && measureText(candidate) > maxWidth) {
            pushCurrent();
            currentText = "";
            currentStart = tokenStart + (token.match(/^\s+/)?.[0]?.length || 0);
            currentEnd = currentStart;
          }

          if (!currentText && measureText(token) > maxWidth) {
            const tokenPieces = splitTokenToFitWidth(token.trimStart(), measureText, maxWidth);
            tokenPieces.forEach((piece, pieceIndex) => {
              const pieceStart = pieceIndex === 0 ? currentStart : currentEnd;
              const pieceEnd = pieceStart + piece.length;
              entries.push({
                number: visibleNumber++,
                logicalNumber,
                isFirstVisualRow,
                text: piece,
                start: pieceStart,
                end: pieceEnd,
              });
              isFirstVisualRow = false;
              currentEnd = pieceEnd;
            });
            currentText = "";
            currentStart = currentEnd;
            return;
          }

          currentText += currentText ? token : token.trimStart();
          if (!currentText.trim()) {
            currentStart = cursor;
            currentEnd = cursor;
          } else {
            currentEnd = tokenStart + token.length;
          }
        });

        if (currentText || !entries.length) {
          pushCurrent();
        }

        if (!isLastLogicalLine) {
          cursor += 1;
        }
      });

      return entries.length ? entries : [{ number: 1, text: "", start: 0, end: 0 }];
    }

    return {
      splitTokenToFitWidth,
      buildWrappedLineEntries,
    };
  }
);

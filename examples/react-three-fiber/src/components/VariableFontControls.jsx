import React, { useEffect } from 'react';
import { useControls } from 'leva';

const VariableFontControls = ({ axes, variations, onVariationsChange }) => {
  // Build controls dynamically based on axes
  const controls = React.useMemo(() => {
    if (!axes || Object.keys(axes).length === 0) {
      return {};
    }

    const result = {};
    for (const [tag, axisInfo] of Object.entries(axes)) {
      // Use the name from the font's STAT table if available, otherwise use defaults
      const name = axisInfo.name 
                 ? axisInfo.name
                 : tag;

      result[name] = {
        value: variations[tag] || axisInfo.default,
        min: axisInfo.min,
        max: axisInfo.max,
        step: tag === "slnt" ? 0.1 : 1, // Slant often uses decimal values
        onChange: (value) => {
          onVariationsChange({
            ...variations,
            [tag]: value,
          });
        },
      };
    }
    return result;
  }, [axes, variations, onVariationsChange]);

  // Use the key prop from parent to force re-creation
  useControls('Text', controls);

  return null;
};

export default VariableFontControls;

import React, { useState, useEffect } from 'react';

const FontDropzone = ({ onFontLoad, currentFontName = 'Default Font' }) => {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleFile = async (file) => {
    const validTypes = ['font/ttf', 'font/otf', 'font/woff'];
    const validExtensions = ['.ttf', '.otf', '.woff'];
    
    const isValidType = validTypes.some(type => file.type === type);
    const isValidExtension = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    
    if (!isValidType && !isValidExtension) {
      alert('Please select a valid font file (TTF, OTF, or WOFF)');
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      onFontLoad(arrayBuffer, file.name);
    } catch (error) {
      console.error('Font loading error:', error);
      alert(`Failed to load font: ${error.message}`);
    }
  };

  useEffect(() => {
    if (isMobile) return;

    const handleDragOver = (e) => {
      e.preventDefault();
      const items = Array.from(e.dataTransfer.items);
      const hasFont = items.some(item => {
        const type = item.type;
        return type === 'font/ttf' || type === 'font/otf' || type === 'font/woff';
      });
      
      if (hasFont) {
        setIsDragActive(true);
      }
    };

    const handleDragLeave = (e) => {
      if (!document.body.contains(e.relatedTarget)) {
        setIsDragActive(false);
      }
    };

    const handleDrop = async (e) => {
      e.preventDefault();
      setIsDragActive(false);
      
      const files = Array.from(e.dataTransfer.files);
      const fontFile = files.find(file => {
        const ext = file.name.toLowerCase();
        return ext.endsWith('.ttf') || ext.endsWith('.otf') || ext.endsWith('.woff');
      });
      
      if (fontFile) {
        await handleFile(fontFile);
      }
    };

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
    };
  }, [onFontLoad, isMobile]);

  if (isMobile || !isDragActive) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(5px)',
        userSelect: 'none'
      }}
    >
      <div 
        style={{
          position: 'absolute',
          top: '24px',
          left: '24px',
          right: '24px',
          bottom: '24px',
          border: '4px dashed #0066cc',
          borderRadius: '8px',
          pointerEvents: 'none'
        }}
      />
      <div style={{
        textAlign: 'center',
        color: 'white',
        padding: '40px'
      }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '48px', color: '#0066cc', fontWeight: '600' }}>
          Drop Font File Here
        </h2>
        
        <p style={{ margin: '0 0 8px 0', fontSize: '24px', color: '#ccc' }}>
          TTF, OTF, or WOFF supported. No files uploaded, all are local in your browser
        </p>
        
        <p style={{ margin: '0', fontSize: '18px', color: '#888' }}>
          Current: <span style={{ color: '#0066cc', fontWeight: '500' }}>{currentFontName}</span>
        </p>
      </div>
    </div>
  );
};

export default FontDropzone;
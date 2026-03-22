import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckSquare, RotateCcw, ZoomIn, ZoomOut, Image as ImageIcon, Type as TypeIcon } from 'lucide-react';
import { detectRegions, DetectedRegion } from './services/geminiService';

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [regions, setRegions] = useState<DetectedRegion[]>([]);
  const [zoom, setZoom] = useState(80);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setImageSrc(base64);
      setRegions([]);
      setIsScanning(true);

      // Extract base64 data
      const base64Data = base64.split(',')[1];
      
      try {
        const detected = await detectRegions(base64Data, file.type);
        setRegions(detected);
      } catch (error) {
        console.error("Detection failed", error);
        // Fallback mock data if API fails
        setRegions([
          { type: 'problem', box: { ymin: 100, xmin: 100, ymax: 200, xmax: 900 } },
          { type: 'image', box: { ymin: 250, xmin: 200, ymax: 500, xmax: 800 } },
          { type: 'choices', box: { ymin: 600, xmin: 100, ymax: 800, xmax: 900 } }
        ]);
      } finally {
        setIsScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col h-screen bg-white font-sans overflow-hidden">
      {/* Header */}
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2 text-blue-600">
            <FileText size={20} />
            <span className="font-medium">{fileName || '파일을 선택해주세요'}</span>
          </div>
          <button 
            className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 transition-colors" 
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={18} />
            <span>다른 파일</span>
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept="image/*" 
            className="hidden" 
          />
        </div>
        <div className="flex items-center space-x-4 text-gray-600">
          <button className="flex items-center space-x-1 hover:text-blue-600 transition-colors">
            <CheckSquare size={18} />
            <span>과목 선택</span>
          </button>
          <button 
            className="flex items-center space-x-1 hover:text-blue-600 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <CheckSquare size={18} />
            <span>파일 선택</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-[#f8f9fa] border-r border-gray-200 flex flex-col shrink-0">
          <div className="p-4 flex justify-between items-center text-sm text-gray-600 border-b border-gray-200">
            <span>페이지 목록</span>
            <span className="text-blue-400">1페이지</span>
          </div>
          <div className="p-4 flex-1 overflow-y-auto">
            {imageSrc && (
              <div className="relative border-2 border-blue-500 rounded-md overflow-hidden bg-white shadow-sm">
                <img src={imageSrc} alt="Thumbnail" className="w-full h-auto" />
                <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white text-xs px-3 py-1 rounded-full whitespace-nowrap">
                  {regions.length}문항
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Main Canvas */}
        <main className="flex-1 bg-[#eef0f2] relative overflow-hidden flex flex-col">
          {/* Toolbar */}
          <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-white rounded-full shadow-lg px-6 py-3 flex items-center space-x-6 z-20">
            <button className="text-gray-600 hover:text-gray-900 transition-colors">
              <RotateCcw size={20} />
            </button>
            <div className="w-px h-6 bg-gray-200"></div>
            <button className="flex flex-col items-center text-gray-600 hover:text-blue-600 transition-colors">
              <FileText size={18} />
              <span className="text-[10px] mt-1 font-medium">문제</span>
            </button>
            <button className="flex flex-col items-center text-gray-600 hover:text-blue-600 transition-colors">
              <ImageIcon size={18} />
              <span className="text-[10px] mt-1 font-medium">그림</span>
            </button>
            <div className="w-px h-6 bg-gray-200"></div>
            <button 
              className="text-gray-600 hover:text-gray-900 transition-colors" 
              onClick={() => setZoom(z => Math.max(20, z - 10))}
            >
              <ZoomOut size={20} />
            </button>
            <span className="text-sm font-medium w-12 text-center">{zoom}%</span>
            <button 
              className="text-gray-600 hover:text-gray-900 transition-colors" 
              onClick={() => setZoom(z => Math.min(200, z + 10))}
            >
              <ZoomIn size={20} />
            </button>
          </div>

          {/* Canvas Area */}
          <div className="flex-1 overflow-auto flex items-center justify-center p-12">
            {!imageSrc ? (
              <div className="text-center bg-white p-12 rounded-2xl shadow-sm border border-gray-100">
                <Upload size={48} className="mx-auto text-blue-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">수능 이미지를 업로드하세요</h3>
                <p className="text-gray-500 mb-6">1초만에 스캔하여 문제와 텍스트 영역을 감지합니다</p>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
                >
                  파일 선택
                </button>
              </div>
            ) : (
              <div 
                className="relative bg-white shadow-xl transition-transform duration-200 origin-center"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                <img src={imageSrc} alt="Document" className="max-w-none block" style={{ maxHeight: '85vh' }} />
                
                {/* Scanning Animation */}
                {isScanning && (
                  <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
                    <div className="absolute left-0 right-0 h-1 bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.8)] animate-scan"></div>
                    <div className="absolute inset-0 bg-blue-500/5 animate-pulse"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-black/70 text-white px-6 py-3 rounded-full font-medium shadow-lg backdrop-blur-sm flex items-center space-x-3">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>AI 스캔 중...</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Detected Regions */}
                {!isScanning && regions.map((region, idx) => {
                  const top = `${region.box.ymin / 10}%`;
                  const left = `${region.box.xmin / 10}%`;
                  const height = `${(region.box.ymax - region.box.ymin) / 10}%`;
                  const width = `${(region.box.xmax - region.box.xmin) / 10}%`;
                  
                  let bgColor = 'rgba(59, 130, 246, 0.15)'; // blue for problem
                  let borderColor = 'rgba(59, 130, 246, 0.8)';
                  let label = '문제';
                  
                  if (region.type === 'image') {
                    bgColor = 'rgba(16, 185, 129, 0.15)'; // green
                    borderColor = 'rgba(16, 185, 129, 0.8)';
                    label = '그림';
                  } else if (region.type === 'choices') {
                    bgColor = 'rgba(245, 158, 11, 0.15)'; // yellow
                    borderColor = 'rgba(245, 158, 11, 0.8)';
                    label = '보기';
                  }

                  return (
                    <div
                      key={idx}
                      className="absolute border-2 cursor-pointer hover:bg-opacity-30 transition-all group z-10"
                      style={{
                        top, left, height, width,
                        backgroundColor: bgColor,
                        borderColor: borderColor
                      }}
                    >
                      <div 
                        className="absolute -top-7 left-[-2px] bg-white px-3 py-1 text-xs font-bold rounded-t-md shadow-sm opacity-0 group-hover:opacity-100 transition-opacity" 
                        style={{ color: borderColor, border: `2px solid ${borderColor}`, borderBottom: 'none' }}
                      >
                        {label}
                      </div>
                      
                      {/* Corner handles for visual effect */}
                      <div className="absolute -top-1 -left-1 w-2 h-2 bg-white border border-gray-400"></div>
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-white border border-gray-400"></div>
                      <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-white border border-gray-400"></div>
                      <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-white border border-gray-400"></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export function BloomMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="智晟｜綻放">
      <svg
        className="brand-mark"
        viewBox="0 0 48 48"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="bloom-petal-wash" cx="38%" cy="28%">
            <stop offset="0" stopColor="#f39b78" />
            <stop offset=".58" stopColor="#d96e59" />
            <stop offset="1" stopColor="#b95445" stopOpacity=".78" />
          </radialGradient>
          <radialGradient id="bloom-heart-wash" cx="35%" cy="30%">
            <stop offset="0" stopColor="#fffdf5" />
            <stop offset=".72" stopColor="#fbf4df" />
            <stop offset="1" stopColor="#efbd55" stopOpacity=".48" />
          </radialGradient>
          <filter
            id="bloom-watercolor"
            x="-18%"
            y="-18%"
            width="136%"
            height="136%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency=".055"
              numOctaves="3"
              seed="8"
              result="paperNoise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="paperNoise"
              scale="1.45"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        <g filter="url(#bloom-watercolor)">
          <path
            className="brand-petal-wash"
            d="M24 9c3.9-7.6 12.3-5 11.5 3.5C43.7 10 47.8 17.8 41 23c7.2 4.7 3.5 12.8-4.8 10.7.3 8.5-8 10.7-11.8 3.1-4.5 7.3-12.5 4.3-11.4-4.1-8.4 1.3-11.2-7.1-3.6-11-6.6-5.4-1.8-12.9 6.4-11.3C15.5 1.7 21.6 3.2 24 9Z"
          />
          <path
            className="brand-petal-bloom"
            d="M23.8 9.5c3.3-5.8 8.5-4.7 9.5 1.2-3.7 2.4-6.5 6.1-8.4 11.2-1.8-4.6-2.1-8.8-1.1-12.4Zm12.1 4.1c5.8-2.2 9.3 2.7 5.3 7.4-4.4-.7-8.8.2-13.5 2.6 2.3-4.3 5.1-7.7 8.2-10Zm4.2 12.6c5.1 3.1 2.8 8.6-3.1 7.8-1.3-4.2-4-7.6-8-10.5 4.7-.2 8.5.7 11.1 2.7Z"
          />
          <circle
            className="brand-heart-wash"
            cx="24"
            cy="23.5"
            r="7.3"
          />
        </g>
      </svg>
      {!compact && (
        <span className="brand-name">
          智晟｜<strong>綻放</strong>
        </span>
      )}
    </div>
  );
}

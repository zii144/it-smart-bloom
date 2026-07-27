const petals = Array.from({ length: 20 }, (_, index) => index + 1);

export function FlowerRain() {
  return (
    <>
      <div className="sunset-reflection" aria-hidden="true">
        <span />
      </div>
      <div className="flower-rain" aria-hidden="true">
        {petals.map((petal) => (
          <span
            className={`falling-petal falling-petal-${petal}`}
            key={petal}
          >
            <i />
          </span>
        ))}
      </div>
    </>
  );
}

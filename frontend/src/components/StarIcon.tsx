interface StarIconProps {
  filled?: boolean;
  className?: string;
}

const StarIcon = ({ filled = false, className = "" }: StarIconProps) => {
  if (filled) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <path
          d="M8 0.5L10.163 5.38197L15.6085 6.21885L11.8042 9.86803L12.7634 15.2812L8 12.8L3.23664 15.2812L4.19577 9.86803L0.391548 6.21885L5.83697 5.38197L8 0.5Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M8 1.5L9.854 5.68197L14.4635 6.38197L11.2318 9.48803L12.0451 14.0312L8 11.9L3.95491 14.0312L4.76823 9.48803L1.53654 6.38197L6.146 5.68197L8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
};

export default StarIcon;
